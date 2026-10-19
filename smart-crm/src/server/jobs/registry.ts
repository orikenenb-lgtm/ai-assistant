/**
 * Imports every module that registers job handlers, event subscribers or
 * recurring schedules. The worker and the cron route import this file once.
 * Add one line per module.
 */
import "../events";
import "./maintenance";
import "@/modules/ai/proposals";
