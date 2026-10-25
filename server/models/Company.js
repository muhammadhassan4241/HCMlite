import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true, maxlength: 160, default: "" },
    line2: { type: String, trim: true, maxlength: 160, default: "" },
    city: { type: String, trim: true, maxlength: 100, default: "" },
    region: { type: String, trim: true, maxlength: 100, default: "" },
    postalCode: { type: String, trim: true, maxlength: 24, default: "" },
    country: { type: String, trim: true, maxlength: 100, default: "" }
  },
  { _id: false }
);

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    logoUrl: { type: String, trim: true, maxlength: 2048, default: "" },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
    phone: { type: String, trim: true, maxlength: 32, default: "" },
    address: { type: addressSchema, default: () => ({}) },
    timeZone: { type: String, required: true, default: "UTC" },
    workingDays: {
      type: [{ type: String, enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] }],
      default: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    },
    openingTime: { type: String, required: true, default: "09:00" },
    closingTime: { type: String, required: true, default: "17:00" }
  },
  { timestamps: true }
);

const Company = mongoose.models.Company || mongoose.model("Company", companySchema);

export default Company;
