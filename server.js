require('dotenv').config(); 
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const { verifyToken, adminOnly, employeeOrAdmin } = require("./authMiddleware");

const app = express();

/* ===================== CORS CONFIGURATION ===================== */
const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
    "https://main.d18b34rzjw22p4.amplifyapp.com" 
];

app.use(cors({ 
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            return callback(new Error('CORS blocked'), false);
        }
        return callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options(/(.*)/, cors()); 

app.use(express.json());

/* ===================== DATABASE CONNECTION ===================== */
const db = mysql.createPool({
  // priority is given to Env variables, but defaults are filled with your RDS data
  host: process.env.DB_HOST || "database-1.cvuukc64q17g.us-east-1.rds.amazonaws.com",
  user: process.env.DB_USER || "admin",
  password: process.env.DB_PASSWORD || "Anumimdad12",
  database: process.env.DB_NAME || "my_app_data",
  port: 3306,
  connectionLimit: 10,
  ssl: { rejectUnauthorized: false }
});

// Test Connection on start
db.getConnection((err, conn) => {
    if (err) {
        console.error("❌ Database Connection Failed!");
        console.error("Error Detail:", err.message);
    } else {
        console.log("✅ Database Connected successfully to RDS");
        conn.release();
    }
});

/* ===================== DB HELPERS ===================== */
const syncUserToDb = (userData) => {
  return new Promise((resolve, reject) => {
    const { cognito_id, email, firstName, user_role } = userData;
    const safeName = firstName || "User";
    
    let safeRole = user_role || "Candidate";
    if (email === "imdadanam4@gmail.com") safeRole = "Admin";

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

app.get("/", (req, res) => {
    res.send("🚀 Backend is running and connected to RDS!");
});

app.post("/sync-user", verifyToken, async (req, res) => {
  try {
    const { cognito_id, email } = req.user;
    db.query("SELECT user_role FROM users WHERE cognito_id = ?", [cognito_id], async (err, rows) => {
      if (err) return res.status(500).json({ error: "DB Fetch error" });
      
      if (rows.length > 0) {
        return res.json({ message: "User synced", role: rows[0].user_role });
      } else {
        await syncUserToDb(req.user);
        const finalRole = (email === "imdadanam4@gmail.com") ? "Admin" : "Candidate";
        return res.json({ message: "New user created", role: finalRole });
      }
    });
  } catch (err) {
    console.error("Sync Crash:", err);
    res.status(500).json({ error: "Sync failed" });
  }
});

app.get("/users", verifyToken, employeeOrAdmin, (req, res) => {
  const { cognito_id } = req.user;
  db.query("SELECT user_role FROM users WHERE cognito_id = ?", [cognito_id], (err, userRows) => {
    if (err) return res.status(500).json({ error: "Permission check failed" });
    const actualRole = userRows[0]?.user_role || "Candidate";
    
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

app.delete("/delete-user/:id", verifyToken, adminOnly, (req, res) => {
    const targetId = req.params.id;
    if (targetId === req.user.cognito_id) return res.status(400).json({ error: "Cannot delete self" });

    db.query("DELETE FROM users WHERE cognito_id = ?", [targetId], (err) => {
        if (err) return res.status(500).json({ error: "Delete failed" });
        res.json({ message: "User removed successfully" });
    });
});

app.get("/tasks", verifyToken, (req, res) => {
  db.query("SELECT * FROM tasks WHERE user_id=? ORDER BY created_at DESC", [req.user.cognito_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/add-task", verifyToken, (req, res) => {
  const { task_text, status } = req.body;
  if (!task_text) return res.status(400).json({ error: "Missing task text" });

  db.query(
    "INSERT INTO tasks (user_id, task_text, status) VALUES (?, ?, ?)",
    [req.user.cognito_id, task_text, status || "Personal"],
    (err, result) => {
      if (err) {
          console.error("❌ SQL Error in add-task:", err.message);
          return res.status(500).json({ error: err.message });
      }
      res.json({ task_id: result.insertId, task_text, status: status || "Personal" });
    }
  );
});

app.delete("/delete-task/:id", verifyToken, (req, res) => {
    const { cognito_id } = req.user;
    
    db.query("SELECT user_role FROM users WHERE cognito_id = ?", [cognito_id], (err, rows) => {
      const isAdmin = rows[0]?.user_role === "Admin";
      const sql = isAdmin ? "DELETE FROM tasks WHERE task_id=?" : "DELETE FROM tasks WHERE task_id=? AND user_id=?";
      const params = isAdmin ? [req.params.id] : [req.params.id, cognito_id];

      db.query(sql, params, (err) => {
        if (err) return res.status(500).json({ error: "Delete failed" });
        res.json({ message: "Task deleted" });
      });
    });
});

app.put("/update-role/:id", verifyToken, adminOnly, (req, res) => {
  const { role } = req.body;
  db.query("UPDATE users SET user_role=? WHERE cognito_id=?", [role, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Update failed" });
    res.json({ message: "Role updated successfully" });
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));