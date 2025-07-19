
# How to Guide on Setting Up the App

## **Important Note at the bottom**

### API keys

**huggingface:**
go to [Hugging Face](https://huggingface.co)
Sign up for an account and open it by clicking your profile picture in the top right
In the dropdown, click Access Tokens
on that page, create a new token by clicking the button "+ Create new token"
enter a token name and under finegrained -> Inference, check the first 2 boxes,
not manage as its not required.
Scroll Down and click create token
Copy the token and save it somewhere for later use.

**Calgary API:**
Go to [Calgary Login](https://data.calgary.ca/login) and create an account using any of
the 3 options
Then go to [Calgary Dev Portal](https://data.calgary.ca/profile/edit/developer_settings)
Click Create New App Token & give it a name and desription
Copy the token and Secret token to somewhere safe for later use

**.env files:**
create 2 files called .env, one in the backedn and one in the frontend folder

in the frontend, set the api URL, this could be either your local host or web service
REACT_APP_API_URL=`http://localhost:5050/api`

in the backend .env

CALGARY_APP_TOKEN=**Paste your APP token from earlier**
CALGARY_API_SECRET=**Paste your Secret token from earlier**

CALGARY_LAND_USE_API=`https://data.calgary.ca/resource/qe6k-p9nh.json`
BUILDING_API_URL=`https://data.calgary.ca/resource/cchr-krqg.json`

FLASK_ENV=development
FLASK_DEBUG=True
FLASK_PORT=5050
CORS_ORIGINS=**replace with your frontend URL**

HUGGINGFACE_API_TOKEN=**Paste your hugging face api**

## Local build

create a venv environment in backend by:
-cd backend
-python3 -m venv .venv
-source .venv/bin/activate -- assuming MacOs or linux

run pip install -r requirements.txt / or run make setup

place your .env files in their respective folders

do cd .. to return to the main directory
run make flask
in another terminal, run npm install
do cd .. to return to the main directory / or run make setup
run make dev

in a web browser, open `http://localhost:3000`
A dev environment should be set up now!

## Deployment

1. GitHub account with your code pushed
2. Render account (free tier available)
3. Hugging Face API token
4. Calgary API token

### Step 1. Deploy Flask Backend

1. Create a web service on Render
From the dashboard, click "New" -> Web Service
Connect your GitHub repo
select the name of the repo

2. **Configure Render for backend**
Name: calgary-map-backend -- important
Region: The region nearest to you
Branch: main
Root directory: backend
Runtime: Python 3
Build command: ./build.sh
Start command: python app.py
Select free tier

3. **Envinronment variables**
Set your environment variables from above, either by loading from file or
pasting each one individually

4. **Deploy**
Click "Create Web Service"
Wait for deployment (5-10 minutes)
Note the backend URL (e.g., `https://calgary-map-backend.onrender.com`)
the url will be based on the name you entered

## 2. Deploy Frontend

1. **Static site on render**
From the dashboard, click "New" -> Static Site
Connect the same GitHub repository

2. **Configure Frontend**
Name: calgary-map-frontend
Branch: main
Root Directory: frontend
Build Command: npm run build
Publish Directory: build

3. **Envinronment variables**
REACT_APP_API_URL=`https://your-backend-url.onrender.com/api` (e.g.,
    `https://calgary-map-backend.onrender.com`)

4. **Deploy**
Click "Create Static site"
Wait for deployment (5-10 minutes)
open the url `https://calgary-map-frontend.onrender.com`

## Important

As a reult of hosting the websites backend on a free tool,
after 15min of inactivity, the backend turns off.
Normally, sending a request to the website will wake it up, however
occasionally it will not. In that case, you amy need to restart the backend from
the dashboard and visit the link
Mine for example is [https://calgary-map-website.onrender.com](https://calgary-map-website.onrender.com)
after visitng render will automatically start loading up the backend and you can
continue to use the app normally
if mine still doesnt display the buildings after starting the backend,
Please send me an email and ill restart it
