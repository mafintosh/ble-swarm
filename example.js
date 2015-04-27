var swarm = require('./')
var sw = swarm()

sw.on('peer', function (stream) {
  console.log('new connection!')
  process.stdin.pipe(stream).pipe(process.stdout)
})