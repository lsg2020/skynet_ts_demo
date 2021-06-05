import * as skynet from "skynet"
import * as mongo from "skynet/db/mongo"

skynet.start(async () => {
    let client = await mongo.MongoClient.client({
        addr: {
            host: "127.0.0.1",
            port: 27017,
        }
    });
    let db = await client.get_db("skynet_ts");
    let c1 = await db.get_collection("c1");

    for (let i=0; i<10; i++) {
        c1.insert({
            name: `name_${i}`,
            index: i,
            now: Date.now(),
        })
    }

    {
        let cur = c1.find({name: "name_1"}, {_id: 0});
        while (await cur.has_next()) {
            let r = cur.next();
            console.log(r);
        }    
    }

    await c1.safe_update({name: "name_1"}, {$set: {now: 1234}}, true, true);

    {
        let cur = c1.find({name: "name_1"}, {_id: 0});
        while (await cur.has_next()) {
            let r = cur.next();
            console.log(r);
        }    
    }


})