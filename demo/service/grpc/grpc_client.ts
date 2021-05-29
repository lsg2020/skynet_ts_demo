import * as skynet from "skynet"
import { getClient } from "x/grpc_basic/client";
import { Greeter } from "./greeter.d";

const protoFile = await Deno.readTextFile("./demo/service/grpc/greeter.proto");

skynet.start(async () => {
  let [service_name, port] = JS_INIT_ARGS.split(" ");

  const client = getClient<Greeter>({
    port: Number(port),
    root: protoFile,
    serviceName: "Greeter",
  });

  /* unary calls */
  console.log(await client.SayHello({ name: "unary #1" }));
  console.log(await client.SayHello({ name: "unary #2" }));

  /* server stream */
  for await (const reply of client.ShoutHello({ name: "streamed abcdef" })) {
    console.log(reply);
  }
})

