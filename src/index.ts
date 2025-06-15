import 'dotenv/config';
import 'reflect-metadata';
import express, { Application, Request, Response } from 'express';
import { DataSource } from 'typeorm';

// Initialize Express app
const app: Application = express();
app.use(express.json());

// TypeORM DataSource setup
const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  synchronize: true, // Set to false in production
  logging: false,
  entities: [], // Add entity files here
  ssl: { rejectUnauthorized: false },
});

// Initialize the database connection
AppDataSource.initialize()
  .then(() => {
    console.log('Data Source has been initialized!');
  })
  .catch((err) => {
    console.error('Error during Data Source initialization', err);
  });

// Define a basic route
app.get('/', (req: Request, res: Response) => {
  res.send('Hello from ts Express + TypeORM + PostgreSQL! Nazdeeki backend!!');
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});