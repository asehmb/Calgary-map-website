

all: flask dev

flask:
	cd backend
	flask run

dev:
	cd frontend && npm start