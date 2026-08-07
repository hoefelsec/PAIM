/**
 * Loopback-only bind target. Not a setting — see docs/10-execution-safety.md
 * §1: the service binds to 127.0.0.1 and never to 0.0.0.0, so no other
 * machine on the network can reach the port.
 */
export const HOST = "127.0.0.1";
export const PORT = 4400;
