

all: flask dev

flask:
	cd backend
	flask run --port=5050

dev:
	cd frontend && npm start