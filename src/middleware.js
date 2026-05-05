import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
import { totalRequests, successfulRequests, failedRequests } from './metrics.js';

async function updateMetrics(ctx, next) {
	await next();

	if (ctx.path !== "/metrics") {
		totalRequests.inc({ method: ctx.method, status_code: ctx.status })
		if (200 <=ctx.status && ctx.status <= 299) {
			successfulRequests.inc({ method: ctx.method, status_code: ctx.status})
		} else {
			failedRequests.inc({ method: ctx.method, status_code: ctx.status })
		}
	}
}

async function validateUser(ctx, next) {
	const authHeader = ctx.headers['authorization'];
	if (!authHeader) {
		ctx.status = 401;
		ctx.body = { error: 'Authorization header is required', message: null };
		return;
	}

	const token = authHeader.split(' ')[1];
	const { data, error } = await supabase.auth.getUser(token);


	if (error || !data) {
		console.log(`Failed to authenticate user with token ${token}`)
		ctx.status = 401;
		ctx.body = { error: 'Invalid or expired token', message: null };
		return;
	}

	ctx.state.user = data.user;

	await next();
};

// In-memory sliding-window rate limit. Per-process — fine for a single
// broker instance. Move to Redis if we ever scale this horizontally.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_PER_HOUR || '100', 10);
const rateLimitBuckets = new Map(); // userId -> [timestamps]

function pruneBucket(timestamps, now) {
	const cutoff = now - RATE_LIMIT_WINDOW_MS;
	while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
}

async function checkRateLimit(ctx, next) {
	const user = ctx.state.user;
	if (!user) {
		throw new Error('checkRateLimit requires validateUser to have populated ctx.state.user first');
	}

	const now = Date.now();
	let timestamps = rateLimitBuckets.get(user.id);
	if (!timestamps) {
		timestamps = [];
		rateLimitBuckets.set(user.id, timestamps);
	}
	pruneBucket(timestamps, now);

	if (timestamps.length >= RATE_LIMIT_MAX) {
		const retryAfterSec = Math.max(1, Math.ceil((timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000));
		ctx.set('Retry-After', String(retryAfterSec));
		ctx.status = 429;
		ctx.body = { error: 'Rate limit exceeded. Try again later.', message: null };
		return;
	}

	timestamps.push(now);
	await next();
}

// Periodically drop empty buckets so the Map doesn't grow unbounded.
setInterval(() => {
	const now = Date.now();
	for (const [id, timestamps] of rateLimitBuckets) {
		pruneBucket(timestamps, now);
		if (timestamps.length === 0) rateLimitBuckets.delete(id);
	}
}, 10 * 60 * 1000).unref?.();

export { validateUser, checkRateLimit, updateMetrics };
