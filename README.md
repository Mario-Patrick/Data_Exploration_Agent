# Data_Exploration_Agent
This repository will be the home for the Data Exploration Agent inclusive of the front, back end and any relevant information relating to the project or use there of.

# Getting started
1. Clone the repository
    ```bash
    git clone <repository-url>
    ```
    (Replace <repository-url> with the actual URL for the repository.)

2. Open a bash terminal and navigate to the project directory
   ```bash
   cd ./pipeline_JL/AI_Data_Explorer
   ```
3. Run the setup script (this will automatically install python 3.12 if you did not have it)
   ```bash
   ./start.sh
   ```
4. <b>ONLY</b> If you didnt have the correct python version, after install, open a new terminal and run the script again. 
   ```bash
   cd ./pipeline_JL/AI_Data_Explorer
   ./start.sh
   ```
5. The frontend should be accesible in a browser at <b>localhost:5173</b>
6. <b>After initial install</b> if you just want to run the application after everything is set up, you can run:
   ```bash
   cd ./pipeline_JL/AI_Data_Explorer
   ./serve.sh
   ```
7. You will need a .env file with a Deepseek api key. DEEPSEEK_API_KEY=. Ask me for it and i will give you