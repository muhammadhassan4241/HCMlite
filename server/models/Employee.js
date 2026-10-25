import mongoose from "mongoose";

const employeeSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    employeeId: { type: String, required: true, trim: true, maxlength: 32 },
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, required: true, trim: true, maxlength: 80 },
    workEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 32, default: "" },
    photoUrl: { type: String, trim: true, maxlength: 2048, default: "" },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null },
    designationId: { type: mongoose.Schema.Types.ObjectId, ref: "Designation", default: null },
    joiningDate: { type: Date, required: true },
    employmentType: {
      type: String,
      enum: ["Full-time", "Part-time", "Contract", "Temporary", "Intern"],
      required: true
    },
    status: {
      type: String,
      enum: ["Active", "Inactive", "On Leave"],
      default: "Active",
      required: true
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    accountDeactivatedByEmployee: { type: Boolean, default: false, select: false }
  },
  { timestamps: true }
);

employeeSchema.index({ companyId: 1, employeeId: 1 }, { unique: true });
employeeSchema.index(
  { companyId: 1, workEmail: 1 },
  { unique: true, partialFilterExpression: { workEmail: { $type: "string" } } }
);
employeeSchema.index(
  { companyId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } }
);
employeeSchema.index({ companyId: 1, status: 1, lastName: 1, firstName: 1 });

const Employee = mongoose.models.Employee || mongoose.model("Employee", employeeSchema);

export default Employee;
