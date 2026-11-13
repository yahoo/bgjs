// The graph changes shape at runtime: each room is its own extent, added and removed while the
// program runs, and one behavior re-links its demands to whatever rooms exist.
//
//   node bin/bg-trace.js examples/rooms.mjs --html rooms.html
import * as bg from 'behavior-graph';

class Room extends bg.Extent {
  constructor(graph, name, temp) {
    super(graph);
    this.debugName = name;
    this.temp = this.state(temp);
  }
}

class House extends bg.Extent {
  constructor(graph) {
    super(graph);
    this.addRoom = this.moment();
    this.removeRoom = this.moment();
    this.rooms = this.state([]);
    this.coldest = this.state(null);

    this.behavior()
      .demands(this.addRoom, this.removeRoom)
      .supplies(this.rooms)
      .runs(() => {
        if (this.addRoom.justUpdated) {
          const { name, temp } = this.addRoom.value;
          const room = new Room(this.graph, name, temp);
          this.addChildLifetime(room);
          room.addToGraph();
          this.rooms.update([...this.rooms.value, room]);
        }
        if (this.removeRoom.justUpdated) {
          const room = this.rooms.value.find(r => r.debugName === this.removeRoom.value);
          room.removeFromGraph();
          this.rooms.update(this.rooms.value.filter(r => r !== room));
        }
      });

    this.behavior()
      .demands(this.rooms)
      .dynamicDemands([this.rooms], () => this.rooms.value.map(r => r.temp))
      .supplies(this.coldest)
      .runs(() => {
        const temps = this.rooms.value.map(r => r.temp.value);
        this.coldest.update(temps.length ? Math.min(...temps) : null);
      });
  }
}

export default function scenario({ trace }) {
  const graph = new bg.Graph();
  const tracer = trace(graph);
  const house = new House(graph);
  tracer.nameBehaviors(house, ['Manage rooms', 'Find the coldest room']);
  house.addToGraphWithAction('start');
  graph.action(() => house.addRoom.update({ name: 'Living', temp: 68 }), 'install living-room sensor');
  graph.action(() => house.addRoom.update({ name: 'Bedroom', temp: 63 }), 'install bedroom sensor');
  graph.action(() => house.rooms.value[1].temp.update(61), 'bedroom reads 61°');
  graph.action(() => house.removeRoom.update('Bedroom'), 'remove bedroom sensor');
}
