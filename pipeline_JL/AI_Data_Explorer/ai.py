# Please install: pip install openai python-dotenv
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

# Load first 10 lines of insurance.csv
with open("insurance.csv", encoding="utf-8") as f:
    csv_sample = "".join(f.readline() for _ in range(11))  # header + 10 rows

client = OpenAI(api_key=os.environ.get('DEEPSEEK_API_KEY'), base_url="https://api.deepseek.com")

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[
        {
            "role": "system",
            "content": "You are a data visualization expert. Given a dataset sample, you recommend specific graphs and exactly which columns go on which axis or role (e.g. x-axis, y-axis, color/series, facet). Be concrete and use the actual column names.",
        },
        {
            "role": "user",
            "content": f"""Here are the first 10 rows of a dataset (CSV):

{csv_sample}

For this dataset, suggest exactly 4 graphs you would make. For each graph give:
1. The type of graph (e.g. bar chart, scatter plot, histogram, line chart, box plot).
2. Which columns go where: x-axis, y-axis, color/series, facets, or other roles.
3. A one-line reason why this graph fits the data.

Format your answer clearly (e.g. numbered list for the 4 graphs, with sub-bullets for column mappings).""",
        },
    ],
    stream=False,
)

print(response.choices[0].message.content)