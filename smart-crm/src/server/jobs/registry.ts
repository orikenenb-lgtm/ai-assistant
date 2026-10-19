/**
 * Imports every module that registers job handlers, event subscribers or
 * recurring schedules. The worker and the cron route import this file once.
 * Add one line per module.
 */
import "../events";
import "./maintenance";
import "@/modules/ai/proposals";
import "@/modules/automation/engine";
import "@/modules/whatsapp/jobs";
import "@/modules/tasks/jobs";
import "@/modules/billing/jobs";
import "@/modules/documents/jobs";
