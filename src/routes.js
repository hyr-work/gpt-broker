import crypto from "node:crypto"
import Router from "koa-router"
import { validateUser, checkRateLimit } from "./middleware.js"
import { generateResponse, generateResponseStream } from "./openaiChatCompletions.js"
import { register }  from "./metrics.js"
import { validateStreamResponse } from "./requestValidators.js"

const router = new Router();


/*
 * For health checks
 */
router.get('/health', async ctx => {
	ctx.status = 200;
	ctx.body = "OK";
	return;
})


// Prometheus metrics. Locked behind a shared token so we don't leak
// internal request volume / model usage / failure rates publicly.
// If METRICS_TOKEN is unset, the endpoint 404s (don't reveal existence).
router.get('/metrics', async ctx => {
	const expected = process.env.METRICS_TOKEN;
	if (!expected) {
		ctx.status = 404;
		ctx.body = { error: 'Endpoint not found' };
		return;
	}
	const provided = ctx.get('X-Metrics-Token');
	const expectedBuf = Buffer.from(expected, 'utf8');
	const providedBuf = Buffer.from(provided || '', 'utf8');
	if (
		expectedBuf.length !== providedBuf.length ||
		!crypto.timingSafeEqual(expectedBuf, providedBuf)
	) {
		ctx.status = 401;
		ctx.body = { error: 'Unauthorized' };
		return;
	}
	ctx.type = 'text/plain';
	ctx.body = await register.metrics();
})


/*
 * Expects a param 'prompt' for GPT Generation
 * @returns - GPT's response in the message body
 */
router.get('/simple-gpt-4o-mini-complete', validateUser, checkRateLimit, async ctx => {
	const prompt = ctx.query.prompt;

	if (!prompt) {
		ctx.status = 400;
		ctx.body = { error: "Missing required 'prompt' query parameter", message: null };
		return;
	}

	if (typeof prompt !== 'string') {
		ctx.status = 400;
		ctx.body = { error: "'prompt' must be a string", message: null };
		return;
	}

	try {
		const messages = [{ role: "system", content: prompt }]
		const response = await generateResponse(messages, 0.7, "gpt-4o-mini");
		ctx.body = response;
	} catch (error) {
		console.log("error below:")
		console.error(error);
		ctx.status = 500;
		ctx.body = { error: `GPT Threw an error - ${error.message}`};
	}
})

/*
 * Request body must contain an array of `messages` to pass to GPT
 * ie. [ { role: 'system', content: "Write me a poem" }, ... ]
 * @returns - a response with GPT's response in the body
 */
router.post('/advanced-gpt-4o-mini-complete', validateUser, checkRateLimit, async ctx => {
	const messages = ctx.request.body;
	if (!messages) {
		ctx.status = 400;
		ctx.body = { error: "Missing required 'messages' in body of request", message: null };
		return;
	}
	try {
		const response = await generateResponse(messages, 0.7, "gpt-4o-mini");
		ctx.body = response;
	} catch (error) {
		console.log("error below:")
		console.error(error);
		ctx.status = 500;
		ctx.body = { error: `GPT Threw an error - ${error.message}`, message: null};
	}
})

/*
 * Request a 4o chat completion using a bearer token
 * @header Authorization - The SkillSync access token in the format Bearer <token>
 * @param {Array<Object>} messages - messages to prompt chat completion with
 * @param {number} temperature - (optional) temperature to pass to gpt
 * @returns {Object} - an object with either a "message" or "error" field
 * 
 * @example
 * Request headers:
 * {
 *   "Authorization": "Bearer <token>",
 *   "Content-Type": "application/json"
 * }
 * 
 * @example
 * Request body:
 * {
 * 	messages: [ { role: 'system', content: "Write me a poem" } ]
 * }
 * 
 * @example
 * Request body:
 * {
 * 	messages: [ { role: 'system', content: "Write me a poem" } ]
 *  temperature: 0.7
 * }
 * 
 */
router.post('/v2/advanced-gpt-4o-mini-complete', validateUser, checkRateLimit, async ctx => {
	const messages = ctx.request.body.messages;
	const temperature = ctx.request.body.temperature;

	if (temperature && (typeof temperature !== 'number' || temperature < 0 || temperature > 1)) {
		ctx.status = 400;
		ctx.body = { error: "'temperature' must be a number between [0, 1]" };
		return;
	}

	if (!messages) {
		ctx.status = 400;
		ctx.body = { error: "Missing required 'messages' in body of request", message: null };
		return;
	}

	if (!Array.isArray(messages)) { 
		ctx.status = 400;
		ctx.body = {"error": "'messages' must be an array"}; 
		return;
	}

	for (const message of messages) {
		if (typeof message !== 'object' || !message.role || !message.content) {
			ctx.status = 400;
			ctx.body = {"error": "each 'message' object must have a 'role' and 'content' property"}; 
			return;
		}
	}

	try {
		const response = await generateResponse(messages, temperature, "gpt-4o-mini");
		ctx.body = { message: response};
	} catch (error) {
		console.log("error below:")
		console.error(error);
		ctx.status = 500;
		ctx.body = { error: `GPT Threw an error - ${error.message}`, message: null};
	}
})


router.post('/gpt-4o', validateUser, checkRateLimit, async ctx => {
	const messages = ctx.request.body.messages;
	const temperature = ctx.request.body.temperature;

	if (temperature && (typeof temperature !== 'number' || temperature < 0 || temperature > 1)) {
		ctx.status = 400;
		ctx.body = { error: "'temperature' must be a number between [0, 1]" };
		return;
	}

	if (!messages) {
		ctx.status = 400;
		ctx.body = { error: "Missing required 'messages' in body of request", message: null };
		return;
	}

	if (!Array.isArray(messages)) { 
		ctx.status = 400;
		ctx.body = {"error": "'messages' must be an array"}; 
		return;
	}

	for (const message of messages) {
		if (typeof message !== 'object' || !message.role || !message.content) {
			ctx.status = 400;
			ctx.body = {"error": "each 'message' object must have a 'role' and 'content' property"}; 
			return;
		}
	}

	try {
		const response = await generateResponse(messages, temperature, "gpt-4o");
		ctx.body = { message: response};
	} catch (error) {
		console.log("error below:")
		console.error(error);
		ctx.status = 500;
		ctx.body = { error: `GPT Threw an error - ${error.message}`, message: null};
	}
})


router.post('/stream', validateUser, checkRateLimit, async ctx => {
	const valid_obj = validateStreamResponse(ctx);
	if (!valid_obj.valid) {
		ctx.status = 400;
		ctx.body = { error: valid_obj.message };
		return;
	}
	ctx.set('Content-Type', 'application/json');
	ctx.set('Cache-Control', 'no-cache');
	ctx.set('Connection', 'keep-alive');
	ctx.status = 200;
	ctx.respond = false;

	const { messages, temperature = 0.7, model } = ctx.request.body;

	try {
		for await (const chunk of generateResponseStream(messages, temperature, model)) {
			// Add \n to the receiver can accept one line at a time
			ctx.res.write(JSON.stringify({ data: chunk }) + '\n');
		}
	} catch (err) {
		console.error('Streaming error', err);
		// Add \n to the receiver can accept one line at a time
		ctx.res.write(JSON.stringify({ error: "Error while streaming" }) + '\n');
	} finally {
		ctx.res.end();
	}
});



export { router };
