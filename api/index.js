const path = require("path");
const { handleRequest } = require(path.join(__dirname, "..", "server.js"));

module.exports = async (req, res) => {
  await handleRequest(req, res);
};
