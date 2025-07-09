import { FastifyInstance, FastifyPluginOptions } from "fastify";

class InvalidQRCodeError extends Error {}

export default function router(fastify: FastifyInstance, options: FastifyPluginOptions) {
    fastify.post<{ Body: { key: string; data: string } }>(
        "/scan-qr-code/submit",
        { schema: { body: { type: "object", properties: { key: { type: "string" }, data: { type: "string" } } } } },
        async (req, reply) => {
            const scanToken = fastify.bot().getScanToken(req.body.key);
            if (!scanToken) {
                req.log.warn(`SCAN SUBMIT - Invalid key: ${req.body.key}`);
                return reply.status(401).send({ error: "Invalid key." });
            }

            if (!req.body.data.startsWith(fastify.bot().generateLoginUrl(scanToken.connection))) {
                req.log.warn(`SCAN SUBMIT - Invalid URL: ${req.body.data}`);
                return reply.status(400).send({ error: "Invalid url." });
            }

            try {
                await new Promise<void>((resolve, reject) =>
                    fastify.bot().handleAttendanceReceived(
                        req.body.data,
                        (event) => {
                            if (event == "invalid") reject(new InvalidQRCodeError());
                            else if (event == "success") resolve();
                        },
                        scanToken.connection,
                    ),
                );
            } catch (err) {
                if (err instanceof InvalidQRCodeError) {
                    req.log.warn(`SCAN SUBMIT - Invalid QR code: ${req.body.data}`);
                    return reply.status(400).send({ error: "Invalid qr-code." });
                } else {
                    req.log.error(`SCAN SUBMIT - Error processing QR code: ${req.body.data}`, err);
                    return reply.status(500).send({ error: "Internal server error." });
                }
            }

            return reply.status(201).send();
        },
    );

    fastify.get("/test", async (req, reply) => {
        return reply.send("Hello World!");
    });
}
