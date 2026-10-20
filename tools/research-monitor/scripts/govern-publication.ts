import { resolve } from "node:path";
import { checkPublicationSize, prunePublishedShards } from "./publication-retention";

const [output = "dist", previous = "../../research-monitor"] = process.argv.slice(2);
const retention = await prunePublishedShards(resolve(output, "data"), resolve(previous, "data"));
const size = await checkPublicationSize(resolve(output));
console.log(
  `Publication: ${size.bytes} bytes across ${size.files} files; retained ${retention.retained} referenced shards, removed ${retention.removed.length} orphan shards (${retention.removedBytes} bytes).`,
);
