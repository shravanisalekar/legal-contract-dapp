require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const contractRoutes = require("./routes/contracts");
const documentRoutes = require("./routes/documents");
const userRoutes = require("./routes/users");
const auditRoutes = require("./routes/audit");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads"))); // served only for demo convenience

app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/contracts", contractRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/users", userRoutes);
app.use("/api/audit", auditRoutes);

// Multer / generic error handler - always last
app.use((err, req, res, next) => {
  if (err) {
    // Logs which route and which exact line threw, not just the message -
    // needed to tell apart e.g. a milestone-save bug from a validation bug
    // from an auth bug, all of which otherwise print an identical-looking
    // one-line error with no way to tell them apart.
    console.error(`[${req.method} ${req.originalUrl}]`, err.stack || err.message);
    return res.status(400).json({ error: err.message || "Something went wrong" });
  }
  next();
});

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

app.listen(PORT, () => {
  console.log(`Legal Contract Lifecycle backend running on http://localhost:${PORT}`);
});
