export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: "The requested resource was not found" }
  });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const status = error.code === 11000
    ? 409
    : Number.isInteger(error.status)
      ? error.status
      : 500;
  const code = error.code === 11000
    ? "DUPLICATE_RESOURCE"
    : status === 400
      ? "BAD_REQUEST"
      : "INTERNAL_SERVER_ERROR";
  const duplicateMessage = "A record with the same company-scoped name already exists";
  const message = status < 500 ? error.message : "An unexpected error occurred";

  if (status >= 500) {
    console.error(error);
  }

  return res.status(status).json({
    success: false,
    error: { code, message: error.code === 11000 ? duplicateMessage : message }
  });
}
