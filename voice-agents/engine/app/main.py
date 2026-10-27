"""Run the engine: python -m app.main"""

import os

import uvicorn

from app.server import create_app

app = create_app()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
