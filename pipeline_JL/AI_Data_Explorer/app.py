import os
import re
import uuid
import json
import unicodedata
from datetime import datetime
import pandas as pd
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
REGISTRY_PATH = os.path.join(BASE_DIR, "datasets.json")

for d in (UPLOADS_DIR, GARBAGE_DIR, LOGS_DIR):
    os.makedirs(d, exist_ok=True)


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
- Recommend as many graphs as are genuinely useful (typically 3–6). Do not pad with redundant charts.
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
        df = pd.read_csv(file)
    except Exception as e:
        return jsonify({"error": f"Failed to parse CSV: {str(e)}"}), 400

    if df.empty or len(df.columns) < 2:
        return jsonify({"error": "CSV must have at least 2 columns and 1 row of data"}), 400

    # Persist the dataset
    dataset_id = str(uuid.uuid4())
    save_path = os.path.join(UPLOADS_DIR, f"{dataset_id}.csv")
    df.to_csv(save_path, index=False)

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


@app.route("/api/explore/<dataset_id>", methods=["POST"])
def explore(dataset_id):
    if dataset_id not in datasets:
        return jsonify({"error": "Dataset not found"}), 404

    csv_path = os.path.join(UPLOADS_DIR, f"{dataset_id}.csv")
    if not os.path.exists(csv_path):
        return jsonify({"error": "Dataset file not found on disk"}), 404

    df = pd.read_csv(csv_path)

    column_info = []
    for col in df.columns:
        dtype = "numeric" if pd.api.types.is_numeric_dtype(df[col]) else "categorical"
        n_unique = int(df[col].nunique())
        column_info.append(f"  {col} ({dtype}, {n_unique} unique values)")
    column_summary = "\n".join(column_info)

    sample_csv = df.head(10).to_csv(index=False)

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

    valid_columns = set(df.columns)
    for i, graph in enumerate(ai_result.get("graphs", [])):
        for field in ("x", "y", "color"):
            if field in graph and graph[field] not in valid_columns:
                return jsonify({
                    "error": f"Graph {i+1}: unknown column '{graph[field]}' in field '{field}'. Valid columns: {list(valid_columns)}"
                }), 500

    csv_data = json.loads(df.to_json(orient="records"))

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

    csv_path = os.path.join(UPLOADS_DIR, f"{dataset_id}.csv")
    if not os.path.exists(csv_path):
        return jsonify({"error": "Dataset file not found on disk"}), 404

    meta = datasets[dataset_id]
    per_page = max(1, int(request.args.get("per_page", 50)))
    total = meta["row_count"]
    columns = meta["columns"]
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(int(request.args.get("page", 1)), total_pages))
    start = (page - 1) * per_page

    # skiprows skips data rows 1..start (row 0 = header is kept)
    skip = range(1, start + 1)
    df_page = pd.read_csv(csv_path, skiprows=skip, nrows=per_page, header=0, names=columns)
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

    # Remove CSV from uploads
    csv_path = os.path.join(UPLOADS_DIR, f"{dataset_id}.csv")
    if os.path.exists(csv_path):
        os.remove(csv_path)

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

    csv_path = os.path.join(UPLOADS_DIR, f"{dataset_id}.csv")
    if not os.path.exists(csv_path):
        return jsonify({"error": "Dataset file not found on disk"}), 404

    df = pd.read_csv(csv_path)
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
    df_clean.to_csv(csv_path, index=False)
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

    csv_path = os.path.join(UPLOADS_DIR, f"{dataset_id}.csv")
    if not os.path.exists(csv_path):
        return jsonify({"error": "Dataset file not found on disk"}), 404

    body = request.get_json() or {}
    requested = body.get("steps", [])
    steps_to_run = [s for s in PREPROCESS_STEPS if s in requested]

    if not steps_to_run:
        return jsonify({"error": "No valid steps selected"}), 400

    df = pd.read_csv(csv_path)
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
    df.to_csv(csv_path, index=False)

    return jsonify({"steps_run": steps_to_run, "results": results})


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
