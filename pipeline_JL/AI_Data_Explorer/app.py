import os
try:
    import regex as re
except ImportError:
    import re
import uuid
import json
import unicodedata
from datetime import datetime
import pandas as pd
import duckdb
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder="frontend/dist", static_url_path="")
CORS(app)

client = OpenAI(
    api_key=os.environ["DEEPSEEK_API_KEY"],
    base_url="https://api.deepseek.com"
)

# Server-side directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
GARBAGE_DIR = os.path.join(BASE_DIR, "garbage")
LOGS_DIR = os.path.join(BASE_DIR, "logs")
REGEX_RESULTS_DIR = os.path.join(BASE_DIR, "regex_results")
REGISTRY_PATH = os.path.join(BASE_DIR, "datasets.json")

for d in (UPLOADS_DIR, GARBAGE_DIR, LOGS_DIR, REGEX_RESULTS_DIR):
    os.makedirs(d, exist_ok=True)


def _dataset_path(dataset_id: str) -> str:
    """Absolute path to the dataset's Parquet file."""
    return os.path.join(UPLOADS_DIR, f"{dataset_id}.parquet")


def _duckdb() -> duckdb.DuckDBPyConnection:
    """Return a fresh in-memory DuckDB connection (lightweight, thread-safe per call)."""
    return duckdb.connect()


def _safe_col(col: str) -> str:
    """Escape double quotes in a column name for DuckDB SQL identifiers."""
    return col.replace('"', '""')


def _regex_result_path(dataset_id, column):
    safe_col = ''.join(c if c.isalnum() or c == '_' else '_' for c in column)
    return os.path.join(REGEX_RESULTS_DIR, f"{dataset_id}__{safe_col}.json")


def load_registry():
    if os.path.exists(REGISTRY_PATH):
        try:
            with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_registry():
    with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
        json.dump(datasets, f, indent=2)


# Persistent dataset registry: { dataset_id: { "name", "row_count", "columns" } }
datasets = load_registry()


def log_action(dataset_id, message):
    log_path = os.path.join(LOGS_DIR, f"{dataset_id}.log")
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"[{timestamp}] {message}\n")


SYSTEM_PROMPT = """You are a data visualization expert. Your job is to analyze a CSV dataset sample and recommend the most useful visualizations.

You MUST respond with valid JSON that matches this schema exactly:
{
  "summary": "<1-2 sentence plain English description of what this dataset contains>",
  "graphs": [
    {
      "type": "<one of: bar, scatter, histogram, box>",
      "title": "<concise chart title>",
      "reason": "<one sentence explaining what insight this chart reveals>",
      "x": "<exact column name from the dataset>",
      "y": "<exact column name — omit this field entirely for histogram>",
      "color": "<exact column name — omit this field entirely if not needed>",
      "agg": "<one of: mean, sum, count — include this field only when type is bar>"
    }
  ]
}

Rules:
- Use ONLY column names that appear in the provided CSV header. Do not invent column names.
- Recommend as many graphs as are genuinely useful (typically 2–5). Do not pad with redundant charts.
- For type "histogram": include only "x", omit "y" and "agg" fields entirely.
- For type "bar": always include "agg" (how to aggregate y per x category). Omit "color".
- For type "scatter": include "x" and "y". "color" is optional — omit if not needed. Only use scatter when BOTH axes are truly continuous numeric columns. Use when both columns either have decimal precision or are very large integers.
- For type "box": "x" is a categorical column (grouping), "y" is a numeric column. Omit "color".
- Choose graph types that reveal genuinely different aspects of the data (distribution, correlation, comparison, composition).
- No markdown, no code fences, no commentary outside the JSON object."""


@app.route("/api/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename.lower().endswith(".csv"):
        return jsonify({"error": "Only CSV files are supported"}), 400

    try:
        df = pd.read_csv(file, low_memory=False)
    except Exception as e:
        return jsonify({"error": f"Failed to parse CSV: {str(e)}"}), 400

    if df.empty or len(df.columns) < 2:
        return jsonify({"error": "CSV must have at least 2 columns and 1 row of data"}), 400

    # Normalize object columns to string before saving to Parquet.
    # Without this, pyarrow infers mixed-type columns (e.g. numeric strings mixed with text)
    # as double and fails with ArrowInvalid when it encounters non-numeric strings.
    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].astype(str).where(df[col].notna(), other=None)

    # Persist the dataset as Parquet
    dataset_id = str(uuid.uuid4())
    save_path = _dataset_path(dataset_id)
    df.to_parquet(save_path, index=False)

    original_name = file.filename
    datasets[dataset_id] = {
        "name": original_name,
        "row_count": len(df),
        "columns": list(df.columns),
    }
    save_registry()
    log_action(dataset_id, f"Uploaded: {original_name} ({len(df)} rows, {len(df.columns)} columns)")

    return jsonify({
        "dataset_id": dataset_id,
        "row_count": len(df),
        "columns": list(df.columns),
    })



def _duckdb_numeric_types():
    """DuckDB type names that we treat as numeric for chart metadata."""
    return frozenset({
        "TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT",
        "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT", "UHUGEINT",
        "FLOAT", "REAL", "DOUBLE", "DECIMAL",
    })


@app.route("/api/explore/<dataset_id>", methods=["POST"])
def explore(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    path = _dataset_path(dataset_id)
    if not os.path.exists(path):
        return jsonify({"error": "Dataset file not found on disk"}), 404

    con = _duckdb()
    numeric_types = _duckdb_numeric_types()

    # Column metadata via DuckDB (no full-file load into pandas)
    desc = con.execute("DESCRIBE SELECT * FROM read_parquet(?)", [path]).fetchall()
    columns = [row[0] for row in desc]
    type_map = {row[0]: (row[1].upper() if row[1] else "VARCHAR") for row in desc}

    # n_unique per column (single scan)
    count_exprs = ", ".join(
        f'COUNT(DISTINCT "{_safe_col(c)}") AS "{_safe_col(c)}_n"'
        for c in columns
    )
    count_row = con.execute(
        f"SELECT {count_exprs} FROM read_parquet(?)",
        [path]
    ).fetchone()
    n_unique_map = {columns[i]: int(count_row[i] or 0) for i in range(len(columns))}

    column_info = []
    for col in columns:
        dtype = "numeric" if type_map.get(col, "").split("(")[0] in numeric_types else "categorical"
        n_unique = n_unique_map.get(col, 0)
        column_info.append(f"  {col} ({dtype}, {n_unique} unique values)")
    column_summary = "\n".join(column_info)

    # First 10 rows for AI prompt
    df_sample = con.execute(
        "SELECT * FROM read_parquet(?) LIMIT 10",
        [path]
    ).df()
    sample_csv = df_sample.to_csv(index=False)

    user_message = f"""Dataset column metadata:
        {column_summary}

        First 10 rows (CSV format):
        {sample_csv}

        Suggest the most useful visualizations for this dataset. Respond with the JSON schema only."""

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            stream=False,
        )
        raw = response.choices[0].message.content
        print("\n=== DeepSeek raw response ===")
        print(raw)
        print("=== end ===\n")
        ai_result = json.loads(raw)
    except json.JSONDecodeError as e:
        return jsonify({"error": f"DeepSeek returned invalid JSON: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"error": f"DeepSeek API error: {str(e)}"}), 500

    valid_columns = set(columns)
    for i, graph in enumerate(ai_result.get("graphs", [])):
        for field in ("x", "y", "color"):
            if field in graph and graph[field] not in valid_columns:
                return jsonify({
                    "error": f"Graph {i+1}: unknown column '{graph[field]}' in field '{field}'. Valid columns: {list(valid_columns)}"
                }), 500

    body = request.get_json(silent=True) or {}
    sample_size = int(body.get("sample_size", 0) or 0)
    row_count = datasets[dataset_id].get("row_count", 0)

    # Chart data via DuckDB — streams from parquet, no full pandas load
    n = min(sample_size, row_count) if sample_size > 0 and row_count > 0 else 0
    if n > 0:
        df_chart = con.execute(
            f"SELECT * FROM read_parquet(?) USING SAMPLE reservoir({n} ROWS)",
            [path],
        ).df()
    else:
        df_chart = con.execute("SELECT * FROM read_parquet(?)", [path]).df()

    csv_data = json.loads(df_chart.to_json(orient="records"))

    log_action(dataset_id, f"Generate Charts: {len(ai_result.get('graphs', []))} charts generated")

    return jsonify({
        "summary": ai_result.get("summary", ""),
        "graphs": ai_result.get("graphs", []),
        "data": csv_data,
    })


@app.route("/api/data/<dataset_id>", methods=["GET"])
def get_data(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    path = _dataset_path(dataset_id)
    if not os.path.exists(path):
        return jsonify({"error": "Dataset file not found on disk"}), 404

    meta = datasets[dataset_id]
    per_page = max(1, int(request.args.get("per_page", 50)))
    total = meta["row_count"]
    columns = meta["columns"]
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(int(request.args.get("page", 1)), total_pages))
    start = (page - 1) * per_page

    # DuckDB reads only the requested page — no full-file load
    con = _duckdb()
    df_page = con.execute(
        "SELECT * FROM read_parquet(?) LIMIT ? OFFSET ?",
        [path, per_page, start]
    ).df()
    rows = json.loads(df_page.to_json(orient="records"))

    return jsonify({
        "rows": rows,
        "columns": columns,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    })


@app.route("/api/garbage/<dataset_id>", methods=["GET"])
def list_garbage(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    files = []
    for fname in os.listdir(GARBAGE_DIR):
        prefix = f"{dataset_id}_"
        if fname.startswith(prefix) and fname.endswith(".csv"):
            action = fname[len(prefix):-4]
            fpath = os.path.join(GARBAGE_DIR, fname)
            try:
                row_count = sum(1 for _ in open(fpath, encoding="utf-8")) - 1
            except Exception:
                row_count = 0
            files.append({"action": action, "row_count": max(0, row_count)})

    return jsonify({"files": files})


@app.route("/api/garbage/<dataset_id>/<action>", methods=["GET"])
def get_garbage(dataset_id, action):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    fpath = os.path.join(GARBAGE_DIR, f"{dataset_id}_{action}.csv")
    if not os.path.exists(fpath):
        return jsonify({"error": "Garbage file not found"}), 404

    # Fast line count (binary, avoids full CSV parse)
    with open(fpath, "rb") as f:
        total = sum(1 for _ in f) - 1  # subtract header

    # Read just the header for column names
    header_df = pd.read_csv(fpath, nrows=0)
    columns = list(header_df.columns)

    per_page = max(1, int(request.args.get("per_page", 50)))
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(int(request.args.get("page", 1)), total_pages))
    start = (page - 1) * per_page

    skip = range(1, start + 1)
    df_page = pd.read_csv(fpath, skiprows=skip, nrows=per_page, header=0, names=columns)
    rows = json.loads(df_page.to_json(orient="records"))

    return jsonify({
        "rows": rows,
        "columns": columns,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    })


@app.route("/api/datasets", methods=["GET"])
def list_datasets():
    return jsonify([
        {"id": k, "name": v["name"], "row_count": v.get("row_count", 0), "columns": v.get("columns", [])}
        for k, v in datasets.items()
    ])


@app.route("/api/datasets/<dataset_id>", methods=["DELETE"])
def delete_dataset(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    # Remove Parquet file from uploads
    parquet_path = _dataset_path(dataset_id)
    if os.path.exists(parquet_path):
        os.remove(parquet_path)

    # Remove all garbage files for this dataset
    for fname in os.listdir(GARBAGE_DIR):
        if fname.startswith(f"{dataset_id}_") and fname.endswith(".csv"):
            os.remove(os.path.join(GARBAGE_DIR, fname))

    # Remove log file
    log_path = os.path.join(LOGS_DIR, f"{dataset_id}.log")
    if os.path.exists(log_path):
        os.remove(log_path)

    # Remove from registry
    del datasets[dataset_id]
    save_registry()

    return jsonify({"ok": True})


@app.route("/api/logs/<dataset_id>", methods=["GET"])
def get_log(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404
    log_path = os.path.join(LOGS_DIR, f"{dataset_id}.log")
    if not os.path.exists(log_path):
        return jsonify({"lines": []})
    with open(log_path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    return jsonify({"lines": lines})


@app.route("/api/clean/<dataset_id>/duplicates", methods=["POST"])
def clean_duplicates(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    path = _dataset_path(dataset_id)
    if not os.path.exists(path):
        return jsonify({"error": "Dataset file not found on disk"}), 404

    df = pd.read_parquet(path)
    before = len(df)
    dupes = df[df.duplicated()]
    removed = len(dupes)

    # Save removed rows to garbage
    garbage_path = os.path.join(GARBAGE_DIR, f"{dataset_id}_duplicates.csv")
    if removed > 0:
        write_header = not os.path.exists(garbage_path)
        dupes.to_csv(garbage_path, mode="a", header=write_header, index=False)

    # Overwrite working copy with cleaned data
    df_clean = df.drop_duplicates()
    df_clean.to_parquet(path, index=False)
    after = len(df_clean)

    # Keep registry in sync so paginated reads use the correct total
    datasets[dataset_id]["row_count"] = after
    save_registry()

    log_action(dataset_id, f"Remove Duplicates: removed {removed} rows ({before} → {after} remaining)")

    return jsonify({
        "action": "duplicates",
        "removed": removed,
        "before": before,
        "after": after,
    })


PREPROCESS_STEPS = [
    "standardize_headers",
    "strip_whitespace",
    "unicode_normalize",
    "remove_empty_rows",
    "deduplicate_columns",
]


@app.route("/api/clean/<dataset_id>/preprocess", methods=["POST"])
def preprocess(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    path = _dataset_path(dataset_id)
    if not os.path.exists(path):
        return jsonify({"error": "Dataset file not found on disk"}), 404

    body = request.get_json() or {}
    requested = body.get("steps", [])
    steps_to_run = [s for s in PREPROCESS_STEPS if s in requested]

    if not steps_to_run:
        return jsonify({"error": "No valid steps selected"}), 400

    df = pd.read_parquet(path)
    results = {}

    for step in steps_to_run:
        if step == "standardize_headers":
            old_cols = list(df.columns)
            new_cols = []
            for c in old_cols:
                s = str(c).lower().strip()
                s = re.sub(r"\s+", "_", s)
                s = re.sub(r"[^a-z0-9_]", "", s)
                new_cols.append(s or "unnamed")
            rename_map = {o: n for o, n in zip(old_cols, new_cols) if o != n}
            df.columns = new_cols
            results["standardize_headers"] = {"renamed": rename_map}
            if rename_map:
                log_action(dataset_id, f"Preprocess standardize_headers: renamed {len(rename_map)} columns")

        elif step == "deduplicate_columns":
            cols = list(df.columns)
            seen = {}
            rename_map = {}
            new_cols = []
            for c in cols:
                if c in seen:
                    seen[c] += 1
                    new_name = f"{c}_{seen[c] + 1}"
                    rename_map[new_name] = c
                    new_cols.append(new_name)
                else:
                    seen[c] = 0
                    new_cols.append(c)
            df.columns = new_cols
            results["deduplicate_columns"] = {"renamed": rename_map}
            if rename_map:
                log_action(dataset_id, f"Preprocess deduplicate_columns: renamed {len(rename_map)} duplicate columns")

        elif step == "strip_whitespace":
            text_cols = df.select_dtypes(include=["object"]).columns.tolist()
            for col in text_cols:
                df[col] = df[col].apply(
                    lambda x: x.strip() if isinstance(x, str) else x
                )
            results["strip_whitespace"] = {"columns_affected": len(text_cols)}
            if text_cols:
                log_action(dataset_id, f"Preprocess strip_whitespace: stripped {len(text_cols)} columns")

        elif step == "unicode_normalize":
            text_cols = df.select_dtypes(include=["object"]).columns.tolist()
            cells_changed = 0
            for col in text_cols:
                before = df[col].copy()
                mask = df[col].notna() & (df[col].astype(str) != "")
                df.loc[mask, col] = df.loc[mask, col].astype(str).apply(
                    lambda x: unicodedata.normalize("NFKC", x)
                )
                cells_changed += (before != df[col]).sum()
            results["unicode_normalize"] = {"cells_changed": int(cells_changed)}
            if cells_changed:
                log_action(dataset_id, f"Preprocess unicode_normalize: {cells_changed} cells changed")

        elif step == "remove_empty_rows":
            before = len(df)

            def _is_empty(v):
                return pd.isna(v) or (
                    isinstance(v, str) and v.strip() in ("", "nan")
                )

            empty_mask = df.apply(
                lambda row: all(_is_empty(v) for v in row), axis=1
            )
            empty_rows = df[empty_mask]
            removed = len(empty_rows)
            if removed > 0:
                garbage_path = os.path.join(GARBAGE_DIR, f"{dataset_id}_empty_rows.csv")
                empty_rows.to_csv(garbage_path, index=False)
                df = df[~empty_mask]
            after = len(df)
            results["remove_empty_rows"] = {"removed": removed, "before": before, "after": after}
            if removed:
                log_action(dataset_id, f"Preprocess remove_empty_rows: removed {removed} rows ({before} → {after})")

    datasets[dataset_id]["row_count"] = len(df)
    datasets[dataset_id]["columns"] = list(df.columns)
    save_registry()
    df.to_parquet(path, index=False)

    return jsonify({"steps_run": steps_to_run, "results": results})


REGEX_SUGGEST_SYSTEM = """You are a data quality expert. Given a column name and sample values from a CSV dataset, suggest a single regex pattern that matches the expected valid format of that column's data.You may also be given additional instructions from the user that will be very important to consider and mention in your reasoning.

You MUST respond with valid JSON only:
{"pattern": "<regex pattern>", "reason": "<one sentence explaining the pattern>"}

Rules:
- The pattern should use Python fullmatch semantics (it must match the entire string). The backend validates using the third-party `regex` library's `fullmatch()`.
- Keep the pattern practical and not overly strict.
- No markdown, no code fences, no commentary outside the JSON object."""

CLEANING_RECOMMEND_SYSTEM = """You are a data cleaning expert. You will be given a column name, the regex pattern that valid values must fully match, a sample of non-matching values, and a list of available cleaning scripts.

Your job is to recommend only scripts that would genuinely transform the non-matching values into values that satisfy the regex — without destroying the structure or meaning of the data.

Before recommending any script, reason through it carefully:
1. Look at the non-matching values. What is wrong with them? (extra characters, wrong case, whitespace, unwanted symbols, etc.)
2. Look at what the script actually does. Would applying it fix the specific problem you identified?
3. Consider side effects: would the script corrupt values that are almost correct, strip meaningful characters, or make the data worse? If so, do NOT recommend it.
4. A script is only worth recommending if you are confident it improves more values than it harms.

When in doubt, return nothing. An empty recommendation is far better than a wrong one.

You MUST respond with valid JSON only:
{"recommendations": [{"script_id": "<id from the provided list>", "reason": "<one sentence: what is wrong with the values AND how this script fixes it>"}, ...]}

Rules:
- Only use script_ids from the provided list. Never invent new ones.
- Return at most 3 recommendations, ordered from most to least confident.
- If you are not confident a script genuinely helps, omit it entirely.
- If no script is a clear improvement, return {"recommendations": []}.
- No markdown, no code fences, no commentary outside the JSON object."""


@app.route("/api/clean/<dataset_id>/regex-suggest", methods=["POST"])
def regex_suggest(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    path = _dataset_path(dataset_id)
    if not os.path.exists(path):
        return jsonify({"error": "Dataset file not found on disk"}), 404

    body = request.get_json() or {}
    column = body.get("column")
    hint = body.get("hint", "").strip()
    previous_pattern = body.get("previous_pattern", "").strip()
    if not column:
        return jsonify({"error": "column is required"}), 400

    if column not in datasets[dataset_id].get("columns", []):
        return jsonify({"error": f"Column '{column}' not found"}), 400

    sc = _safe_col(column)
    con = _duckdb()
    rows = con.execute(
        f'SELECT DISTINCT CAST("{sc}" AS VARCHAR) FROM read_parquet(?) WHERE "{sc}" IS NOT NULL LIMIT 30',
        [path]
    ).fetchall()
    samples = [r[0] for r in rows]

    suggest_line = "Additional user instructions: " + hint if hint else ""
    user_message = f'Column name: "{column}"\nSample values: {samples}\n\n{suggest_line}'
    if previous_pattern:
        user_message += f"\n\nPrevious regex (refine or replace this): /{previous_pattern}/"

    print("[regex-suggest] Prompt (system):", REGEX_SUGGEST_SYSTEM)
    print("[regex-suggest] Prompt (user):", user_message)

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": REGEX_SUGGEST_SYSTEM},
                {"role": "user", "content": user_message},
            ],
            stream=False,
        )
        raw_content = response.choices[0].message.content
        print("[regex-suggest] AI raw response:", raw_content)
        result = json.loads(raw_content)
    except json.JSONDecodeError as e:
        return jsonify({"error": f"DeepSeek returned invalid JSON: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"error": f"DeepSeek API error: {str(e)}"}), 500

    return jsonify({"pattern": result.get("pattern", ""), "reason": result.get("reason", "")})


@app.route("/api/clean/<dataset_id>/regex-check", methods=["POST"])
def regex_check(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    path = _dataset_path(dataset_id)
    if not os.path.exists(path):
        return jsonify({"error": "Dataset file not found on disk"}), 404

    body = request.get_json() or {}
    column = body.get("column")
    pattern = body.get("pattern", "").strip()

    if not column:
        return jsonify({"error": "column is required"}), 400
    if not pattern:
        return jsonify({"error": "pattern is required"}), 400
    if column not in datasets[dataset_id].get("columns", []):
        return jsonify({"error": f"Column '{column}' not found"}), 400

    # Validate pattern with Python regex library (fast, gives good error messages)
    try:
        compiled = re.compile(pattern, re.UNICODE)
    except (re.error, ValueError, OverflowError) as e:
        return jsonify({"error": f"Invalid regex: {str(e)}"}), 400

    sc = _safe_col(column)

    # Try DuckDB path — vectorized C++ regex, replaces the Python apply loop
    try:
        con = _duckdb()

        # Counts: nulls always count as matching
        count_row = con.execute(f"""
            SELECT
                COUNT(*) FILTER (WHERE "{sc}" IS NULL
                                 OR regexp_full_match(CAST("{sc}" AS VARCHAR), ?)) AS match_count,
                COUNT(*) FILTER (WHERE "{sc}" IS NOT NULL
                                 AND NOT regexp_full_match(CAST("{sc}" AS VARCHAR), ?)) AS no_match_count
            FROM read_parquet(?)
        """, [pattern, pattern, path]).fetchone()
        match_count, no_match_count = count_row

        # Examples (up to 5, non-null only)
        match_ex = con.execute(f"""
            SELECT DISTINCT CAST("{sc}" AS VARCHAR)
            FROM read_parquet(?)
            WHERE "{sc}" IS NOT NULL AND regexp_full_match(CAST("{sc}" AS VARCHAR), ?)
            LIMIT 5
        """, [path, pattern]).fetchall()

        no_match_ex = con.execute(f"""
            SELECT DISTINCT CAST("{sc}" AS VARCHAR)
            FROM read_parquet(?)
            WHERE "{sc}" IS NOT NULL AND NOT regexp_full_match(CAST("{sc}" AS VARCHAR), ?)
            LIMIT 5
        """, [path, pattern]).fetchall()

        match_examples = [r[0] for r in match_ex]
        no_match_examples = [r[0] for r in no_match_ex]

        # Full value lists for results file (used by recommend-cleaning + pagination)
        match_vals = con.execute(f"""
            SELECT CAST("{sc}" AS VARCHAR)
            FROM read_parquet(?)
            WHERE "{sc}" IS NOT NULL AND regexp_full_match(CAST("{sc}" AS VARCHAR), ?)
        """, [path, pattern]).fetchall()

        no_match_vals = con.execute(f"""
            SELECT CAST("{sc}" AS VARCHAR)
            FROM read_parquet(?)
            WHERE "{sc}" IS NOT NULL AND NOT regexp_full_match(CAST("{sc}" AS VARCHAR), ?)
        """, [path, pattern]).fetchall()

        match_values = [r[0] for r in match_vals]
        no_match_values = [r[0] for r in no_match_vals]

    except Exception:
        # Fallback: Python apply loop (slower, 100% compatible with regex library features)
        df = pd.read_parquet(path)
        if column not in df.columns:
            return jsonify({"error": f"Column '{column}' not found"}), 400

        null_mask = df[column].isna()
        col_str = df[column].fillna('').astype(str)
        mask = col_str.apply(lambda x: bool(compiled.fullmatch(x))) | null_mask

        def clean_examples(series):
            import math
            return [
                v for v in series.unique()[:5].tolist()
                if not (isinstance(v, float) and math.isnan(v))
            ]

        match_count = int(mask.sum())
        no_match_count = int((~mask).sum())
        match_examples = clean_examples(col_str[mask & ~null_mask])
        no_match_examples = clean_examples(col_str[~mask])
        match_values = col_str[mask & ~null_mask].tolist()
        no_match_values = col_str[~mask].tolist()

    # Persist pattern + last-run stats for this column
    if "regex_patterns" not in datasets[dataset_id]:
        datasets[dataset_id]["regex_patterns"] = {}
    datasets[dataset_id]["regex_patterns"][column] = {
        "pattern": pattern,
        "match_count": int(match_count),
        "no_match_count": int(no_match_count),
    }
    save_registry()

    # Write full match/no-match value lists to a dedicated file for pagination
    # Preserve applied_scripts from any previous run so they survive a re-check
    result_path = _regex_result_path(dataset_id, column)
    applied_scripts = []
    if os.path.exists(result_path):
        try:
            with open(result_path, "r", encoding="utf-8") as f:
                applied_scripts = json.load(f).get("applied_scripts", [])
        except Exception:
            pass
    with open(result_path, "w", encoding="utf-8") as f:
        json.dump({
            "pattern": pattern,
            "match_values": match_values,
            "no_match_values": no_match_values,
            "applied_scripts": applied_scripts,
        }, f)

    log_action(dataset_id, f"Regex check on '{column}': pattern /{pattern}/ — {int(match_count)} match, {int(no_match_count)} no-match")

    return jsonify({
        "column": column,
        "pattern": pattern,
        "match_count": int(match_count),
        "no_match_count": int(no_match_count),
        "match_examples": match_examples,
        "no_match_examples": no_match_examples,
    })


@app.route("/api/clean/<dataset_id>/regex-patterns", methods=["GET"])
def get_regex_patterns(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404
    return jsonify(datasets[dataset_id].get("regex_patterns", {}))


@app.route("/api/clean/<dataset_id>/regex-results/<path:column>", methods=["GET"])
def get_regex_results(dataset_id, column):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    result_path = _regex_result_path(dataset_id, column)
    if not os.path.exists(result_path):
        return jsonify({"error": "No results stored for this column. Run regex-check first."}), 404

    result_type = request.args.get("type", "match")
    try:
        page = int(request.args.get("page", 0))
        page_size = min(int(request.args.get("page_size", 20)), 100)
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid page or page_size"}), 400

    try:
        with open(result_path, "r", encoding="utf-8") as f:
            stored = json.load(f)
    except Exception as e:
        return jsonify({"error": f"Failed to read results: {str(e)}"}), 500

    values = stored["match_values"] if result_type == "match" else stored["no_match_values"]
    total = len(values)
    start = page * page_size
    end = start + page_size

    return jsonify({
        "column": column,
        "pattern": stored["pattern"],
        "type": result_type,
        "total": total,
        "page": page,
        "page_size": page_size,
        "values": values[start:end],
        "has_more": end < total,
    })


@app.route("/api/clean/<dataset_id>/recommend-cleaning", methods=["POST"])
def recommend_cleaning(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    body = request.get_json() or {}
    column = body.get("column")
    if not column:
        return jsonify({"error": "column is required"}), 400

    result_path = _regex_result_path(dataset_id, column)
    if not os.path.exists(result_path):
        return jsonify({"error": "No regex results for this column. Run regex-check first."}), 404

    with open(result_path, "r", encoding="utf-8") as f:
        stored = json.load(f)

    no_match_sample = stored.get("no_match_values", [])[:10]
    pattern = stored.get("pattern", "")

    from cleaning_scripts import get_script_menu, SCRIPTS_BY_ID
    applied_scripts = stored.get("applied_scripts", [])
    script_menu = [s for s in get_script_menu() if s["id"] not in applied_scripts]

    prompt_user = (
        f'Column: "{column}"\n'
        f"Regex pattern (fullmatch — values must match this to be valid): /{pattern}/\n"
        f"Non-matching values (up to 20 samples that failed the regex check):\n{json.dumps(no_match_sample, ensure_ascii=False)}\n\n"
        f"Available cleaning scripts:\n{json.dumps(script_menu, indent=2, ensure_ascii=False)}\n\n"
        "Recommend which scripts would most likely fix these non-matching values."
    )

    try:
        print(prompt_user, CLEANING_RECOMMEND_SYSTEM)
        response = client.chat.completions.create(
            model="deepseek-chat",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": CLEANING_RECOMMEND_SYSTEM},
                {"role": "user", "content": prompt_user},
            ],
            max_tokens=600,
        )
        ai_result = json.loads(response.choices[0].message.content)
    except Exception as e:
        return jsonify({"error": f"AI error: {str(e)}"}), 500

    # Filter out any hallucinated script_ids and enrich with the script's own description
    recs = [
        {
            "script_id": r["script_id"],
            "reason": r.get("reason", ""),
            "description": SCRIPTS_BY_ID[r["script_id"]]["description"],
        }
        for r in ai_result.get("recommendations", [])[:3]
        if r.get("script_id") in SCRIPTS_BY_ID
    ]
    log_action(dataset_id, f"Cleaning recommendations for '{column}': {[r['script_id'] for r in recs]}")
    return jsonify({"recommendations": recs})


@app.route("/api/clean/<dataset_id>/apply-cleaning", methods=["POST"])
def apply_cleaning(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    path = _dataset_path(dataset_id)
    if not os.path.exists(path):
        return jsonify({"error": "Dataset file not found"}), 404

    body = request.get_json() or {}
    column = body.get("column")
    script_id = body.get("script_id")
    if not column:
        return jsonify({"error": "column is required"}), 400
    if not script_id:
        return jsonify({"error": "script_id is required"}), 400

    from cleaning_scripts import SCRIPTS_BY_ID
    script = SCRIPTS_BY_ID.get(script_id)
    if not script:
        return jsonify({"error": f"Unknown script_id: '{script_id}'"}), 400

    try:
        df = pd.read_parquet(path)
        if column not in df.columns:
            return jsonify({"error": f"Column '{column}' not found"}), 400
        original = df[column].copy()
        df[column] = script["apply"](df[column])
        changed_count = int((df[column] != original).sum())
        df.to_parquet(path, index=False)
        sample_values = df[column].dropna().astype(str).unique()[:5].tolist()
    except Exception as e:
        return jsonify({"error": f"Failed to apply script: {str(e)}"}), 500

    # Record this script as applied so the AI won't recommend it again
    result_path = _regex_result_path(dataset_id, column)
    if os.path.exists(result_path):
        try:
            with open(result_path, "r", encoding="utf-8") as f:
                stored = json.load(f)
            if script_id not in stored.get("applied_scripts", []):
                stored.setdefault("applied_scripts", []).append(script_id)
            with open(result_path, "w", encoding="utf-8") as f:
                json.dump(stored, f)
        except Exception:
            pass

    log_action(dataset_id, f"Applied cleaning script '{script_id}' to '{column}': {changed_count} values changed")
    return jsonify({
        "success": True,
        "script_id": script_id,
        "column": column,
        "changed_count": changed_count,
        "sample_values": sample_values,
    })


def _build_scope_mask(df, column, dataset_id, scope):
    """Return a boolean Series selecting rows that fall within the requested scope.
    scope: 'matching' | 'non_matching' | 'both'
    Null rows are always treated as matching (consistent with regex-check behaviour).
    """
    if scope == 'both':
        return pd.Series([True] * len(df), index=df.index)
    result_path = _regex_result_path(dataset_id, column)
    if not os.path.exists(result_path):
        return pd.Series([True] * len(df), index=df.index)
    try:
        with open(result_path, "r", encoding="utf-8") as f:
            stored = json.load(f)
        stored_pat = stored.get("pattern", "")
        if not stored_pat:
            return pd.Series([True] * len(df), index=df.index)
        compiled = re.compile(stored_pat, re.UNICODE)
        null_mask = df[column].isna()
        col_str = df[column].fillna("").astype(str)
        regex_match = col_str.apply(lambda x: bool(compiled.fullmatch(x))) | null_mask
        if scope == 'matching':
            return regex_match & ~null_mask
        else:  # non_matching
            return ~regex_match
    except Exception:
        return pd.Series([True] * len(df), index=df.index)


@app.route("/api/clean/<dataset_id>/find-replace-preview", methods=["POST"])
def find_replace_preview(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    body = request.get_json() or {}
    column = body.get("column")
    pattern = body.get("pattern", "")
    is_regex = body.get("is_regex", False)
    scope = body.get("scope", "both")

    if not column:
        return jsonify({"error": "column is required"}), 400
    if not pattern:
        return jsonify({"matches": []})
    if column not in datasets[dataset_id].get("columns", []):
        return jsonify({"error": f"Column '{column}' not found"}), 400

    path = _dataset_path(dataset_id)
    if not os.path.exists(path):
        return jsonify({"error": "Dataset file not found"}), 404

    sc = _safe_col(column)

    # Build the search expression
    try:
        search_pat = pattern if is_regex else re.escape(pattern)
        # Validate the pattern
        re.compile(search_pat, re.UNICODE)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    # Load stored column regex for scope filtering
    stored_pattern = None
    if scope != 'both':
        result_path = _regex_result_path(dataset_id, column)
        if os.path.exists(result_path):
            try:
                with open(result_path, "r", encoding="utf-8") as f:
                    stored_pattern = json.load(f).get("pattern", "")
            except Exception:
                pass

    try:
        con = _duckdb()

        # Build scope clause
        scope_clause = ""
        params = [path]
        if scope != 'both' and stored_pattern:
            if scope == 'matching':
                scope_clause = f'AND (regexp_full_match(CAST("{sc}" AS VARCHAR), ?) OR "{sc}" IS NULL)'
            else:  # non_matching
                scope_clause = f'AND NOT regexp_full_match(CAST("{sc}" AS VARCHAR), ?) AND "{sc}" IS NOT NULL'
            params.append(stored_pattern)

        params.append(search_pat)

        rows = con.execute(f"""
            SELECT CAST("{sc}" AS VARCHAR) AS val
            FROM read_parquet(?)
            WHERE "{sc}" IS NOT NULL
              {scope_clause}
              AND regexp_matches(CAST("{sc}" AS VARCHAR), ?)
            LIMIT 10
        """, params).fetchall()
        matches = [r[0] for r in rows]
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    return jsonify({"matches": matches})


@app.route("/api/clean/<dataset_id>/find-replace", methods=["POST"])
def find_replace(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    path = _dataset_path(dataset_id)
    if not os.path.exists(path):
        return jsonify({"error": "Dataset file not found"}), 404

    body = request.get_json() or {}
    column = body.get("column")
    pattern = body.get("pattern", "")
    replacement = body.get("replacement", "")
    is_regex = body.get("is_regex", False)
    scope = body.get("scope", "both")

    if not column:
        return jsonify({"error": "column is required"}), 400
    if not pattern:
        return jsonify({"error": "pattern is required"}), 400

    try:
        df = pd.read_parquet(path)
        if column not in df.columns:
            return jsonify({"error": f"Column '{column}' not found"}), 400
        scope_mask = _build_scope_mask(df, column, dataset_id, scope)
        original = df[column].copy()
        df.loc[scope_mask, column] = df.loc[scope_mask, column].astype(str).str.replace(pattern, replacement, regex=is_regex)
        changed_count = int((df[column] != original).sum())
        df.to_parquet(path, index=False)
        sample_values = df[column].dropna().astype(str).unique()[:5].tolist()
    except Exception as e:
        return jsonify({"error": f"Find & Replace failed: {str(e)}"}), 500

    log_action(dataset_id, f"Find & Replace on '{column}' [{scope}]: /{pattern}/ → '{replacement}' ({changed_count} changed)")
    return jsonify({"success": True, "changed_count": changed_count, "sample_values": sample_values})


@app.route("/api/clean/<dataset_id>/send-to-garbage", methods=["POST"])
def send_to_garbage(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    path = _dataset_path(dataset_id)
    if not os.path.exists(path):
        return jsonify({"error": "Dataset file not found"}), 404

    body = request.get_json() or {}
    column = body.get("column")
    if not column:
        return jsonify({"error": "column is required"}), 400

    result_path = _regex_result_path(dataset_id, column)
    if not os.path.exists(result_path):
        return jsonify({"error": "No regex results for this column. Run regex-check first."}), 404

    with open(result_path, "r", encoding="utf-8") as f:
        stored = json.load(f)

    pattern = stored.get("pattern", "")
    if not pattern:
        return jsonify({"error": "No pattern found for this column."}), 400

    try:
        compiled = re.compile(pattern, re.UNICODE)
    except Exception as e:
        return jsonify({"error": f"Invalid stored pattern: {str(e)}"}), 500

    try:
        df = pd.read_parquet(path)
        if column not in df.columns:
            return jsonify({"error": f"Column '{column}' not found"}), 400

        col_str = df[column].fillna("").astype(str)

        def safe_fullmatch(x):
            try:
                return bool(compiled.fullmatch(x))
            except Exception:
                return False

        no_match_mask = ~col_str.apply(safe_fullmatch)
        # Exclude originally-null rows (empty string after fillna) from garbage
        originally_null = df[column].isna()
        garbage_mask = no_match_mask & ~originally_null

        invalid_cells = df.loc[garbage_mask, column]
        nullified_count = int(garbage_mask.sum())

        if nullified_count > 0:
            safe_col_name = ''.join(c if c.isalnum() or c == '_' else '_' for c in column)
            garbage_file = os.path.join(GARBAGE_DIR, f"{dataset_id}__{safe_col_name}_garbage.csv")
            garbage_df = pd.DataFrame({
                "row_index": invalid_cells.index.tolist(),
                "column_name": column,
                "cell_value": invalid_cells.values,
                "pattern": pattern,
            })
            if os.path.exists(garbage_file):
                garbage_df.to_csv(garbage_file, mode="a", header=False, index=False)
            else:
                garbage_df.to_csv(garbage_file, index=False)

            df.loc[garbage_mask, column] = None
            df.to_parquet(path, index=False)

    except Exception as e:
        return jsonify({"error": f"Failed to send to garbage: {str(e)}"}), 500

    log_action(dataset_id, f"Sent {nullified_count} non-matching '{column}' cells to garbage (pattern /{pattern}/)")
    return jsonify({
        "success": True,
        "column": column,
        "nullified_count": nullified_count,
    })


@app.route("/api/clean/<dataset_id>/column-samples", methods=["GET"])
def column_samples(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    column = request.args.get("column")
    if not column:
        return jsonify({"error": "column is required"}), 400
    if column not in datasets[dataset_id].get("columns", []):
        return jsonify({"error": f"Column '{column}' not found"}), 400

    path = _dataset_path(dataset_id)
    if not os.path.exists(path):
        return jsonify({"error": "Dataset file not found on disk"}), 404

    sc = _safe_col(column)
    con = _duckdb()
    rows = con.execute(
        f'SELECT DISTINCT CAST("{sc}" AS VARCHAR) FROM read_parquet(?) WHERE "{sc}" IS NOT NULL LIMIT 20',
        [path]
    ).fetchall()
    samples = [r[0] for r in rows]
    return jsonify({"samples": samples})


# Serve React build in production
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    dist_dir = os.path.join(app.root_path, "frontend", "dist")
    if path and os.path.exists(os.path.join(dist_dir, path)):
        return send_from_directory(dist_dir, path)
    return send_from_directory(dist_dir, "index.html")


if __name__ == "__main__":
    app.run(debug=True, port=5003)
