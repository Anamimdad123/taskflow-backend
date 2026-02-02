// server.js
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const { verifyToken, adminOnly, employeeOrAdmin } = require("./authMiddleware");

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

/* ===================== DATABASE CONNECTION ===================== */
const db = mysql.createPool({
  host: "database-1.cvuukc64q17g.us-east-1.rds.amazonaws.com",
  user: "admin",
  password: "Anumimdad12",
  database: "my_app_data",
  connectionLimit: 10,
  ssl: { rejectUnauthorized: false }
});

/* ===================== DB HELPERS ===================== */
const syncUserToDb = (userData) => {
  return new Promise((resolve, reject) => {
    const { cognito_id, email, firstName, user_role } = userData;
    const safeName = firstName || "User";
    const safeRole = user_role || "Candidate";

    const sql = `
      INSERT INTO users (cognito_id, email, firstName, user_role)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        email = VALUES(email),
        firstName = VALUES(firstName)
    `;

    db.query(sql, [cognito_id, email, safeName, safeRole], (err) => {
      if (err) {
        console.error("❌ Sync Error:", err.message);
        reject(err);
      } else resolve();
    });
  });
};

/* ===================== ROUTES ===================== */
app.post("/sync-user", verifyToken, async (req, res) => {
  try {
    const { cognito_id } = req.user;

    db.query("SELECT user_role FROM users WHERE cognito_id = ?", [cognito_id], async (err, rows) => {
      if (err) return res.status(500).json({ error: "DB Fetch error" });

      if (rows.length > 0) {
        return res.json({ message: "User synced from DB", role: rows[0].user_role });
      } else {
        await syncUserToDb(req.user);
        return res.json({ message: "New user created", role: req.user.user_role || "Candidate" });
      }
    });
  } catch (err) {
    console.error("Sync failed:", err.message);
    res.status(500).json({ error: "Sync failed" });
  }
});

app.get("/users", verifyToken, employeeOrAdmin, (req, res) => {
  const { cognito_id } = req.user;

  db.query("SELECT user_role FROM users WHERE cognito_id = ?", [cognito_id], (err, userRows) => {
    if (err) return res.status(500).json({ error: "Permission check failed" });

    const actualRole = userRows.length > 0 ? userRows[0].user_role : req.user.user_role;

    let sql = "SELECT cognito_id, email, firstName, user_role FROM users ORDER BY firstName";
    let params = [];

    if (actualRole === "Employee") {
      sql = "SELECT cognito_id, email, firstName, user_role FROM users WHERE user_role = ? ORDER BY firstName";
      params = ["Candidate"];
    }

    db.query(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });
});

app.get("/tasks/:id", verifyToken, (req, res) => {
  const targetId = req.params.id;
  const { cognito_id, user_role } = req.user;

  db.query("SELECT user_role FROM users WHERE cognito_id = ?", [cognito_id], (err, reqRows) => {
    const requesterRole = reqRows.length > 0 ? reqRows[0].user_role : user_role;

    const proceed = () => {
      db.query("SELECT * FROM tasks WHERE user_id=? ORDER BY created_at DESC", [targetId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
      });
    };

    if (cognito_id === targetId || requesterRole === "Admin") {
      proceed();
    } else if (requesterRole === "Employee") {
      db.query("SELECT user_role FROM users WHERE cognito_id = ?", [targetId], (err, targetRows) => {
        if (targetRows.length > 0 && targetRows[0].user_role === "Candidate") {
          proceed();
        } else {
          res.status(403).json({ error: "Employees can only view Candidate tasks" });
        }
      });
    } else {
      res.status(403).json({ error: "Unauthorized" });
    }
  });
});

app.post("/add-task", verifyToken, (req, res) => {
  const { task_text, status } = req.body;
  if (!task_text || !task_text.trim()) return res.status(400).json({ error: "Task text is required" });

  db.query(
    "INSERT INTO tasks (user_id, task_text, status) VALUES (?, ?, ?)",
    [req.user.cognito_id, task_text, status || "Personal"],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ task_id: result.insertId, task_text, status: status || "Personal" });
    }
  );
});

app.put("/update-role/:id", verifyToken, adminOnly, (req, res) => {
  const { role } = req.body;
  const validRoles = ["Admin", "Employee", "Candidate"];

  if (!role || !validRoles.includes(role)) return res.status(400).json({ error: "Invalid role" });

  db.query("UPDATE users SET user_role=? WHERE cognito_id=?", [role, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Role update failed" });
    res.json({ message: `Role updated to ${role} successfully` });
  });
});

app.delete("/delete-task/:id", verifyToken, (req, res) => {
  const { cognito_id, user_role } = req.user;

  db.query("SELECT user_role FROM users WHERE cognito_id = ?", [cognito_id], (err, rows) => {
    const actualRole = rows.length > 0 ? rows[0].user_role : user_role;
    const isAdmin = actualRole === "Admin";

    const sql = isAdmin ? "DELETE FROM tasks WHERE task_id=?" : "DELETE FROM tasks WHERE task_id=? AND user_id=?";
    const params = isAdmin ? [req.params.id] : [req.params.id, cognito_id];

    db.query(sql, params, (err, result) => {
      if (err) return res.status(500).json({ error: "Delete failed" });
      if (!result.affectedRows) return res.status(403).json({ error: "Unauthorized" });
      res.json({ message: "Task deleted successfully" });
    });
  });
});

/* ===================== START SERVER ===================== */
const PORT = 5000;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
