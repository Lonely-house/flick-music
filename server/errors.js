"use strict";
class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const requireObject = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new AppError("Invalid request");
  return data;
};
const requireId = (value) => {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/i.test(value))
    throw new AppError("Invalid identifier");
  return value;
};
module.exports = { AppError, requireObject, requireId };
