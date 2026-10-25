import mongoose from "mongoose";

export async function connectDatabase(mongoUri) {
  await mongoose.connect(mongoUri);
  console.info("Connected to MongoDB");
}
