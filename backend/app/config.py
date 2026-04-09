from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    app_name: str = "SuperBuzz PPC Analytics"
    debug: bool = False
    database_url: str = "sqlite:///./superbuzz.db"
    cors_origins: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8080",
    ]

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }


settings = Settings()
