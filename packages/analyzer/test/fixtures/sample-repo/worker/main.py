import boto3
import requests
from fastapi import FastAPI

from util import chunk

app = FastAPI()
sqs = boto3.client("sqs")


@app.get("/jobs")
def list_jobs():
    return {"jobs": []}


@app.post("/jobs")
def create_job(urls: list[str]):
    for url in urls:
        r = requests.get(url)
        sqs.send_message(QueueUrl="jobs", MessageBody=r.text)
    return {"queued": len(urls)}
