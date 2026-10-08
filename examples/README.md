# Examples

Each example is its own npm package that uses the library from this repository
(`"behavior-graph": "file:../.."`), so build the library first. At the repository root:

```bash
npm install && npm run build
```

Then, in the example's folder, `npm install` and the command below.

| Example | What it shows | Run |
| --- | --- | --- |
| [`todomvc`](todomvc) | [TodoMVC](https://todomvc.com) with plain DOM code: a list extent that owns a child extent per item, filtering by URL hash, and saving to local storage. | `npm run dev` |
| [`todomvc-react`](todomvc-react) | The same TodoMVC with React components reading graph state through the `useBGState` hook from [`react-behavior-graph`](../react-behavior-graph). The dev and build scripts build that package first. | `npm run dev` |
| [`browser`](browser) | A login form: field validation, enabling the login button, and the login request's states. Bundled with Rollup and served by a small Express server at http://localhost:8080. | `npm run build && node app.js` |
| [`perftests`](perftests) | Timings for adding a large graph, updating it, adding many extents and removing them. | `npm run try` |
