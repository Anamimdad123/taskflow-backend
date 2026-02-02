import { CognitoJwtVerifier } from "aws-jwt-verify";

// Initialize the verifier once outside the function for performance
const verifier = CognitoJwtVerifier.create({
  userPoolId: "us-east-1_7e06SpUx4",
  tokenUse: "id", // Use "access" if you are sending the Access Token instead of ID Token
  clientId: "55kagtn0qce3qhrml4id2l11i2", // IMPORTANT: Add your App Client ID from aws-exports.js here
});

export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Authorization header missing" });
    }

    const token = authHeader.split(" ")[1];
    
    // This one line replaces your getPems, jwt.verify, and axios calls!
    const payload = await verifier.verify(token);

    // Extract roles from groups
    const groups = payload["cognito:groups"] || [];
    let role = "Candidate";
    if (groups.includes("Admin")) role = "Admin";
    else if (groups.includes("Employee")) role = "Employee";

    // Attach user data to the request object
    req.user = {
      cognito_id: payload.sub,
      email: payload.email,
      firstName: payload.given_name || payload["custom:firstName"] || "User",
      groups,
      user_role: role,
    };

    next();
  } catch (err) {
    console.error("AUTH ERROR:", err.message);
    // If token is expired or invalid, aws-jwt-verify throws an error
    res.status(401).json({ error: "Token verification failed or expired" });
  }
};

// These stay exactly the same as your original code
export const adminOnly = (req, res, next) => {
  if (!req.user.groups.includes("Admin")) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

export const employeeOrAdmin = (req, res, next) => {
  if (!req.user.groups.includes("Admin") && !req.user.groups.includes("Employee")) {
    return res.status(403).json({ error: "Access denied" });
  }
  next();
};

export const candidateOnly = (req, res, next) => {
  if (req.user.groups.includes("Admin") || req.user.groups.includes("Employee")) {
    return res.status(403).json({ error: "Candidates only" });
  }
  next();
};