# Data_Exploration_Agent
This repository will be the home for the Data Exploration Agent inclusive of the front, back end and any relevant information relating to the project or use there of.

# Getting started
1. Clone the repository
    ```bash
    git clone <repository-url>
    ```
    (Replace <repository-url> with the actual URL for the repository.)

2. Change directory to the Application
   ```bash
   cd ./pipeline_JL/AI_Data_Explorer
   ```
3. Create a .venv with python 3.12 (you need ot have python 3.12 installed)
   ```bash
   py -3.12 -m venv venv
   ```
4. Install required Python dependencies for both backend and frontend:
   ```bash
   pip install -r requirements.txt
   ```
5. Run the backend
    ```bash
    python app.py
    ```

6. Run the frontend
    ```bash
    cd ./frontend
    npm run dev
    ```