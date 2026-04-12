const { Queue } = require('bullmq');
const redis = require('./redis');

const taskQueue = new Queue('tasks', {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 100,
  },
});

module.exports = taskQueue;
