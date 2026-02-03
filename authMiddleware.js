import { CognitoJwtVerifier } from "aws-jwt-verify";

// Initialize the verifier once outside the function for performance
const verifier = CognitoJwtVerifier.create({
  userPoolId: "us-east-1_7e06SpUx4",
  tokenUse: "id", // Correct - matches your frontend using idToken
  clientId: "55kagtn0qce3qhrml4id2l11i2",
});

export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      console.error("❌ No authorization header");
      return res.status(401).json({ error: "Authorization header missing" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      console.error("❌ No token in authorization header");
      return res.status(401).json({ error: "Token missing" });
    }
    
    // Verify the token
    const payload = await verifier.verify(token);

    // Extract roles from groups (if using Cognito Groups)
    const groups = payload["cognito:groups"] || [];
    let role = "Candidate"; // default
    
    if (groups.includes("Admin")) role = "Admin";
    else if (groups.includes("Employee") || groups.includes("Employer")) role = "Employee";

    // Attach user data to the request object
    req.user = {
      cognito_id: payload.sub,
      email: payload.email,
      firstName: payload.given_name || payload["custom:firstName"] || "User",
      groups,
      user_role: role,
    };

    console.log(`✅ Token verified for user: ${req.user.email} (${req.user.user_role})`);
    next();
  } catch (err) {
    console.error("❌ AUTH ERROR:", err.message);
    res.status(401).json({ error: "Token verification failed or expired" });
  }
};

// Admin only access
export const adminOnly = (req, res, next) => {
  const userRole = req.user?.user_role || req.user?.groups;
  
  // Check both groups and user_role for flexibility
  if (!req.user?.groups?.includes("Admin") && req.user?.user_role !== "Admin") {
    console.error(`❌ Admin access denied for user: ${req.user?.email}`);
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

// Employee or Admin access
export const employeeOrAdmin = (req, res, next) => {
  const groups = req.user?.groups || [];
  const role = req.user?.user_role;
  
  const isAdmin = groups.includes("Admin") || role === "Admin";
  const isEmployee = groups.includes("Employee") || groups.includes("Employer") || role === "Employee" || role === "Employer";
  
  if (!isAdmin && !isEmployee) {
    console.error(`❌ Access denied for user: ${req.user?.email} (role: ${role})`);
    return res.status(403).json({ error: "Access denied. Employee or Admin required." });
  }
  next();
};

// Candidate only access
export const candidateOnly = (req, res, next) => {
  const groups = req.user?.groups || [];
  const role = req.user?.user_role;
  
  if (groups.includes("Admin") || groups.includes("Employee") || role === "Admin" || role === "Employee") {
    return res.status(403).json({ error: "Candidates only" });
  }
  next();
};