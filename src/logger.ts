import winston from "winston"
import { config } from "./config.js"

export default winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.simple(),
  ),
  defaultMeta: { service: "ipl-trader-node" },
  transports: [new winston.transports.Console()],
  exceptionHandlers: [new winston.transports.Console()],
})
