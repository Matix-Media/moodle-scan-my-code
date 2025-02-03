import { FastifyInstance, FastifyPluginOptions } from "fastify";

export default function router(fastify: FastifyInstance, options: FastifyPluginOptions) {
    fastify.post("/scan-qr-code/submit", async (req, reply) => {
        const { data } = await req.body;
        return reply.status(201).send();
    });

    fastify.get("/test", async (req, reply) => {
        return reply.send("Hello World!");
    });
}
