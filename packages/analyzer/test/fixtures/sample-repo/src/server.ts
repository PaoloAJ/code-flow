import express from 'express';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { query } from './db';

const app = express();
const lambda = new LambdaClient({});

app.get('/photos', async (_req, res) => {
  const rows = await query('SELECT * FROM photos');
  res.json(rows);
});

app.post('/photos', async (req, res) => {
  await lambda.send(new InvokeCommand({ FunctionName: 'resizeImage' }));
  res.status(202).end();
});

app.listen(3000);
