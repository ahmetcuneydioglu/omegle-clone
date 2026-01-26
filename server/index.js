import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

/* ================= SESSION ================= */

app.use(
  session({
    secret: "supersecretkey123",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  })
);

/* ================= BODY PARSER ================= */

app.use(express.json());

/* ================= ADMIN AUTH ================= */

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "123456";

/* Login API */
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).json({ error: "Hatalı giriş" });
  }

  req.session.admin = true;
  res.json({ success: true });
});

/* Logout */
app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin-login.html");
  });
});

/* Admin Guard */
function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.redirect("/admin-login.html");
  }
  next();
}

/* ================= STATIC ================= */

app.use(express.static(path.join(__dirname, "public")));

/* ================= ADMIN PANEL ROUTE ================= */

app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin.html"));
});

/* ================= SOCKET ================= */

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let onlineCount = 0;

io.on("connection", (socket) => {
  onlineCount++;
  io.emit("onlineCount", onlineCount);

  socket.on("disconnect", () => {
    onlineCount--;
    io.emit("onlineCount", onlineCount);
  });
});


