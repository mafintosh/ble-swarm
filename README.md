# ble-swarm

Experimental swarm over bluetooth low energy

```
npm install ble-swarm
```

## Usage

``` js
var swarm = require('ble-swarm')
var sw = swarm({
  uuid: '13333333333333333333333333333337' // must be a 16 bytes hex string
})

sw.on('peer', function (peer) {
  console.log('discovered new peer over bluetooth')
  process.stdin.pipe(peer).pipe(process.stdout)
})
```

## License

MIT
