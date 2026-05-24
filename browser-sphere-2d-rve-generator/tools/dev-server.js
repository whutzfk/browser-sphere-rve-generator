const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 3000);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".xml": "application/xml; charset=utf-8"
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
  const requested = urlPath === "/" ? "/src/taskpane.html" : urlPath;
  const fullPath = path.normalize(path.join(root, requested));
  if (!fullPath.startsWith(root)) {
    send(res, 403, "Forbidden");
    return;
  }
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      send(res, 404, "Not found");
      return;
    }
    send(res, 200, data, types[path.extname(fullPath).toLowerCase()] || "application/octet-stream");
  });
});

server.listen(port, () => {
  console.log(`Sphere 2D RVE browser generator: http://localhost:${port}`);
});
