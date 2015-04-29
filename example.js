var swarm = require('./')
var sw = swarm()

console.log('i am peer-' + process.pid)

sw.on('peer', function (stream) {
  console.log('new connection!')
  var i = 0
  setInterval(function () {
    stream.write('message from remote peer-' + process.pid + ' #' + (++i) + '\n')
  }, 500)
  stream.pipe(process.stdout)
})