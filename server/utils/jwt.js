import jwt from "jsonwebtoken";

export function createAccessToken(user, secret, expiresIn = "15m") {
  if (!user?._id) {
    throw new TypeError("A user id is required to create an access token");
  }
  if (typeof secret !== "string" || secret.length === 0) {
    throw new TypeError("A JWT secret is required");
  }

  return jwt.sign({}, secret, {
    subject: String(user._id),
    expiresIn,
    algorithm: "HS256"
  });
}

export function verifyAccessToken(token, secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new TypeError("A JWT secret is required");
  }

  const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  if (typeof payload === "string" || typeof payload.sub !== "string") {
    throw new jwt.JsonWebTokenError("Invalid access token claims");
  }

  return { userId: payload.sub };
}
