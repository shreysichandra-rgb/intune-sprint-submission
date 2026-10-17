/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as acquisitionRules from "../acquisitionRules.js";
import type * as checkoutPresentation from "../checkoutPresentation.js";
import type * as commandRoute from "../commandRoute.js";
import type * as commands from "../commands.js";
import type * as conversationAction from "../conversationAction.js";
import type * as conversationContext from "../conversationContext.js";
import type * as conversationCopy from "../conversationCopy.js";
import type * as conversationFocus from "../conversationFocus.js";
import type * as conversationInput from "../conversationInput.js";
import type * as conversationLog from "../conversationLog.js";
import type * as conversationMedia from "../conversationMedia.js";
import type * as conversationPerformance from "../conversationPerformance.js";
import type * as conversationPolicy from "../conversationPolicy.js";
import type * as conversationProtocol from "../conversationProtocol.js";
import type * as conversationRollout from "../conversationRollout.js";
import type * as conversationStore from "../conversationStore.js";
import type * as conversationTiming from "../conversationTiming.js";
import type * as copy from "../copy.js";
import type * as cycleReminderSetup from "../cycleReminderSetup.js";
import type * as deliveryState from "../deliveryState.js";
import type * as diagnostics from "../diagnostics.js";
import type * as directTracking from "../directTracking.js";
import type * as groceryMeaning from "../groceryMeaning.js";
import type * as http from "../http.js";
import type * as interpretation from "../interpretation.js";
import type * as labAction from "../labAction.js";
import type * as labAuth from "../labAuth.js";
import type * as labInstructions from "../labInstructions.js";
import type * as labModel from "../labModel.js";
import type * as labStore from "../labStore.js";
import type * as labTime from "../labTime.js";
import type * as labTrace from "../labTrace.js";
import type * as logRedaction from "../logRedaction.js";
import type * as messages from "../messages.js";
import type * as naturalTracking from "../naturalTracking.js";
import type * as operatorPhoneGate from "../operatorPhoneGate.js";
import type * as operatorPhoneSetup from "../operatorPhoneSetup.js";
import type * as phoneUsers from "../phoneUsers.js";
import type * as pilotAccess from "../pilotAccess.js";
import type * as pilotAcquisition from "../pilotAcquisition.js";
import type * as pilotCoupon from "../pilotCoupon.js";
import type * as pilotCouponCampaigns from "../pilotCouponCampaigns.js";
import type * as pilotExperiences from "../pilotExperiences.js";
import type * as pilotGateway from "../pilotGateway.js";
import type * as pilotHttp from "../pilotHttp.js";
import type * as pilotMemory from "../pilotMemory.js";
import type * as pilotName from "../pilotName.js";
import type * as pilotOperator from "../pilotOperator.js";
import type * as pilotPaymentMode from "../pilotPaymentMode.js";
import type * as pilotPayments from "../pilotPayments.js";
import type * as pilotPaymentsStore from "../pilotPaymentsStore.js";
import type * as pilotReminderDelivery from "../pilotReminderDelivery.js";
import type * as pilotReminderRules from "../pilotReminderRules.js";
import type * as pilotReminders from "../pilotReminders.js";
import type * as pilotSocial from "../pilotSocial.js";
import type * as pilotSummary from "../pilotSummary.js";
import type * as pilotTestArchive from "../pilotTestArchive.js";
import type * as pilotTrial from "../pilotTrial.js";
import type * as pilotWelcome from "../pilotWelcome.js";
import type * as plans from "../plans.js";
import type * as progressCheckins from "../progressCheckins.js";
import type * as qaAction from "../qaAction.js";
import type * as qaChecks from "../qaChecks.js";
import type * as qaJudge from "../qaJudge.js";
import type * as qaScenarios from "../qaScenarios.js";
import type * as qaStore from "../qaStore.js";
import type * as reminderRequest from "../reminderRequest.js";
import type * as replyCopy from "../replyCopy.js";
import type * as rules from "../rules.js";
import type * as safety from "../safety.js";
import type * as scheduleReminderSetup from "../scheduleReminderSetup.js";
import type * as semanticBridge from "../semanticBridge.js";
import type * as semanticSafety from "../semanticSafety.js";
import type * as timingSchema from "../timingSchema.js";
import type * as trackedChoice from "../trackedChoice.js";
import type * as tracking from "../tracking.js";
import type * as usageLimits from "../usageLimits.js";
import type * as v4Action from "../v4Action.js";
import type * as v4FoodDate from "../v4FoodDate.js";
import type * as v4Instructions from "../v4Instructions.js";
import type * as v4Language from "../v4Language.js";
import type * as v4Projection from "../v4Projection.js";
import type * as v4ReminderContext from "../v4ReminderContext.js";
import type * as v4Reply from "../v4Reply.js";
import type * as v4Store from "../v4Store.js";
import type * as verificationBarrier from "../verificationBarrier.js";
import type * as verificationDiagnostics from "../verificationDiagnostics.js";
import type * as verificationFixtures from "../verificationFixtures.js";
import type * as verificationRevision from "../verificationRevision.js";
import type * as verificationTransport from "../verificationTransport.js";
import type * as whatsapp from "../whatsapp.js";
import type * as whatsappDelivery from "../whatsappDelivery.js";
import type * as whatsappTyping from "../whatsappTyping.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  acquisitionRules: typeof acquisitionRules;
  checkoutPresentation: typeof checkoutPresentation;
  commandRoute: typeof commandRoute;
  commands: typeof commands;
  conversationAction: typeof conversationAction;
  conversationContext: typeof conversationContext;
  conversationCopy: typeof conversationCopy;
  conversationFocus: typeof conversationFocus;
  conversationInput: typeof conversationInput;
  conversationLog: typeof conversationLog;
  conversationMedia: typeof conversationMedia;
  conversationPerformance: typeof conversationPerformance;
  conversationPolicy: typeof conversationPolicy;
  conversationProtocol: typeof conversationProtocol;
  conversationRollout: typeof conversationRollout;
  conversationStore: typeof conversationStore;
  conversationTiming: typeof conversationTiming;
  copy: typeof copy;
  cycleReminderSetup: typeof cycleReminderSetup;
  deliveryState: typeof deliveryState;
  diagnostics: typeof diagnostics;
  directTracking: typeof directTracking;
  groceryMeaning: typeof groceryMeaning;
  http: typeof http;
  interpretation: typeof interpretation;
  labAction: typeof labAction;
  labAuth: typeof labAuth;
  labInstructions: typeof labInstructions;
  labModel: typeof labModel;
  labStore: typeof labStore;
  labTime: typeof labTime;
  labTrace: typeof labTrace;
  logRedaction: typeof logRedaction;
  messages: typeof messages;
  naturalTracking: typeof naturalTracking;
  operatorPhoneGate: typeof operatorPhoneGate;
  operatorPhoneSetup: typeof operatorPhoneSetup;
  phoneUsers: typeof phoneUsers;
  pilotAccess: typeof pilotAccess;
  pilotAcquisition: typeof pilotAcquisition;
  pilotCoupon: typeof pilotCoupon;
  pilotCouponCampaigns: typeof pilotCouponCampaigns;
  pilotExperiences: typeof pilotExperiences;
  pilotGateway: typeof pilotGateway;
  pilotHttp: typeof pilotHttp;
  pilotMemory: typeof pilotMemory;
  pilotName: typeof pilotName;
  pilotOperator: typeof pilotOperator;
  pilotPaymentMode: typeof pilotPaymentMode;
  pilotPayments: typeof pilotPayments;
  pilotPaymentsStore: typeof pilotPaymentsStore;
  pilotReminderDelivery: typeof pilotReminderDelivery;
  pilotReminderRules: typeof pilotReminderRules;
  pilotReminders: typeof pilotReminders;
  pilotSocial: typeof pilotSocial;
  pilotSummary: typeof pilotSummary;
  pilotTestArchive: typeof pilotTestArchive;
  pilotTrial: typeof pilotTrial;
  pilotWelcome: typeof pilotWelcome;
  plans: typeof plans;
  progressCheckins: typeof progressCheckins;
  qaAction: typeof qaAction;
  qaChecks: typeof qaChecks;
  qaJudge: typeof qaJudge;
  qaScenarios: typeof qaScenarios;
  qaStore: typeof qaStore;
  reminderRequest: typeof reminderRequest;
  replyCopy: typeof replyCopy;
  rules: typeof rules;
  safety: typeof safety;
  scheduleReminderSetup: typeof scheduleReminderSetup;
  semanticBridge: typeof semanticBridge;
  semanticSafety: typeof semanticSafety;
  timingSchema: typeof timingSchema;
  trackedChoice: typeof trackedChoice;
  tracking: typeof tracking;
  usageLimits: typeof usageLimits;
  v4Action: typeof v4Action;
  v4FoodDate: typeof v4FoodDate;
  v4Instructions: typeof v4Instructions;
  v4Language: typeof v4Language;
  v4Projection: typeof v4Projection;
  v4ReminderContext: typeof v4ReminderContext;
  v4Reply: typeof v4Reply;
  v4Store: typeof v4Store;
  verificationBarrier: typeof verificationBarrier;
  verificationDiagnostics: typeof verificationDiagnostics;
  verificationFixtures: typeof verificationFixtures;
  verificationRevision: typeof verificationRevision;
  verificationTransport: typeof verificationTransport;
  whatsapp: typeof whatsapp;
  whatsappDelivery: typeof whatsappDelivery;
  whatsappTyping: typeof whatsappTyping;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
