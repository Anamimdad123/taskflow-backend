const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// Configure JWKS client for Cognito
const client = jwksClient({
  jwksUri: `https://cognito-idp.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, function(err, key) {
    if (err) {
      callback(err);
    } else {
      const signingKey = key.publicKey || key.rsaPublicKey;
      callback(null, signingKey);
    }
  });
}

// Verify JWT token from Cognito
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('❌ No authorization header found');
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);

  jwt.verify(token, getKey, {
    algorithms: ['RS256']
  }, (err, decoded) => {
    if (err) {
      console.error('❌ Token verification failed:', err.message);
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    req.user = {
      cognito_id: decoded.sub,
      email: decoded.email,
      firstName: decoded.given_name || decoded.name
    };

    console.log(`✅ Token verified for user: ${req.user.email}`);
    next();
  });
};

// Admin-only middleware
const adminOnly = (req, res, next) => {
  const mysql = require('mysql2');
  
  const db = mysql.createPool({
    host: process.env.DB_HOST || "database-1.cvuukc64q17g.us-east-1.rds.amazonaws.com",
    user: process.env.DB_USER || "admin",
    password: process.env.DB_PASSWORD || "Anumimdad12",
    database: process.env.DB_NAME || "my_app_data",
    port: 3306,
    connectionLimit: 10,
    ssl: { rejectUnauthorized: false }
  });

  db.query("SELECT user_role FROM users WHERE cognito_id = ?", [req.user.cognito_id], (err, rows) => {
    if (err) {
      console.error("❌ Admin check DB error:", err);
      return res.status(500).json({ error: "Authorization check failed" });
    }

    const userRole = rows[0]?.user_role;
    
    if (userRole !== "Admin") {
      console.log(`❌ Access denied. User role: ${userRole}, Required: Admin`);
      return res.status(403).json({ error: "Access denied. Admin required." });
    }

    console.log(`✅ Admin access granted for: ${req.user.email}`);
    next();
  });
};

// Employee OR Admin middleware - THIS IS THE FIX
const employeeOrAdmin = (req, res, next) => {
  const mysql = require('mysql2');
  
  const db = mysql.createPool({
    host: process.env.DB_HOST || "database-1.cvuukc64q17g.us-east-1.rds.amazonaws.com",
    user: process.env.DB_USER || "admin",
    password: process.env.DB_PASSWORD || "Anumimdad12",
    database: process.env.DB_NAME || "my_app_data",
    port: 3306,
    connectionLimit: 10,
    ssl: { rejectUnauthorized: false }
  });

  db.query("SELECT user_role FROM users WHERE cognito_id = ?", [req.user.cognito_id], (err, rows) => {
    if (err) {
      console.error("❌ Employee/Admin check DB error:", err);
      return res.status(500).json({ error: "Authorization check failed" });
    }

    const userRole = rows[0]?.user_role;
    
    // ✅ FIXED: Allow both Employee AND Admin
    if (userRole !== "Admin" && userRole !== "Employee") {
      console.log(`❌ Access denied. User role: ${userRole}, Required: Employee or Admin`);
      return res.status(403).json({ error: "Access denied. Employee or Admin required." });
    }

    console.log(`✅ Employee/Admin access granted for: ${req.user.email} (Role: ${userRole})`);
    next();
  });
};

module.exports = { verifyToken, adminOnly, employeeOrAdmin };