const fs = require("fs");
const path = require("path");
const http = require("http");
const io = require("socket.io")(8510);
const jsChessEngine = require("js-chess-engine");
var express = require("express");
var config = require("config");
var mongoose = require("mongoose");

var games = {};
var users = 0;
var app = express();

app.use(express.static(path.join(__dirname, "public")));
const routes = require("./routes/token");
app.use(routes);
app.set("port", 8000);
http.createServer(app).listen(app.get("port"), function () {
  console.log("server is listening on port 8000");
});

// configure database
require("./config/database")(app, mongoose);

// Bootstrap models
fs.readdirSync(__dirname + "/models").forEach(function (file) {
  if (~file.indexOf(".js")) require(__dirname + "/models/" + file);
});

io.sockets.on("connection", function (socket) {
  console.log("socket is connected");
  var username = socket.handshake.query.user;
  users++;

  socket.on("join", function (data) {
    console.log("join");
    if (!data.token) return;
    var room = data.token;

    if (!(room in games)) {
      var players = [
        {
          socket: socket,
          name: username,
          status: "joined",
          side: data.side,
        },
        {
          socket: null,
          name: "",
          status: "open",
          side: data.side === "black" ? "white" : "black",
        },
      ];
      games[room] = {
        room: room,
        creator: socket,
        status: "waiting",
        creationDate: Date.now(),
        players: players,
        jce: new jsChessEngine.Game(),
      };

      socket.join(room);
      socket.emit("wait");
      return;
    }

    var game = games[room];

    socket.join(room);
    game.players[1].socket = socket;
    game.players[1].name = username;
    game.players[1].status = "joined";
    game.status = "ready";
    io.sockets.to(room).emit("ready", {
      white: getPlayerName(room, "white"),
      black: getPlayerName(room, "black"),
    });
  });

  socket.on("test", function (data) {
    io.sockets.emit("test", data);
    // socket.broadcast.emit("test", data);
  });

  socket.on("move", function (data) {
    if (!data.token || !games[data.token]) return;
    console.log("move");
    games[data.token].jce.move(data.from, data.to);
    socket.broadcast.to(data.token).emit("move", data);
  });

  // socket.on("ai-move", function (data) {
  //   if (!data.token) return;
  //   var res = games[data.token].jce.aiMove(data.level);
  //   socket
  //     .to(data.token)
  //     .emit("move", { from: Object.keys(res)[0], to: Object.values(res)[0] });
  // });

  // socket.on("moves", function (data) {
  //   if (!data.token) return;
  //   var res = games[data.token].jce.moves(data.from);
  //   socket.to(data.token).emit("moves", { from: data.from, res: res });
  // });

  socket.on("set-piece", function (data) {
    if (!data.token) return;
    games[data.token].jce.setPiece(data.location, data.piece);
    socket.broadcast.to(data.token).emit("set-piece", data);
  });

  socket.on("remove-piece", function (data) {
    if (!data.token) return;
    games[data.token].jce.removePiece(data.location, data.piece);
    socket.broadcast.to(data.token).emit("remove-piece", data);
  });

  socket.on("resign", function (data) {
    if (!data.token) return;
    var room = data.token;
    if (room in games) {
      io.sockets.to(room).emit("player-resigned", {
        side: data.side,
      });
      games[room].players[0].socket.leave(room);
      games[room].players[1].socket.leave(room);
      delete games[room];
    }
  });

  socket.on("disconnect", function () {
    console.log("socket is disconnected.");
    users--;
    for (var token in games) {
      var game = games[token];
      for (var p in game.players) {
        var player = game.players[p];
        if (player.socket === socket) {
          socket.broadcast.to(token).emit("opponent-disconnected");
          delete games[token];
        }
      }
    }
  });
});

function getPlayerName(room, side) {
  var game = games[room];
  for (var p in game.players) {
    var player = game.players[p];
    if (player.side === side) {
      return player.name;
    }
  }
}
