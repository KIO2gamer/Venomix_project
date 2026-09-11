import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pywebpush import webpush, WebPushException

app = FastAPI()

# FIX: Do NOT use dynamic generate_vapid_keys() here. 
# Hardcode static values to prevent key drops during server hot-reloads.
VAPID_PRIVATE_KEY = "YOUR_BACKEND_PRIVATE_KEY_HERE"
VAPID_PUBLIC_KEY = "YOUR_BACKEND_PUBLIC_KEY_HERE"

# CRUCIAL: The mailto claim is mandatory to pass push authorization filters.
VAPID_CLAIMS = {
    "sub": "mailto:logistics-admin@trycloudflare.com"
}

# Temporary database storage for simulation devices
subscribed_devices = []

class SubscriptionModel(BaseModel):
    endpoint: str
    keys: dict
    phone_number: str = None

@app.get("/api/push/public-key")
def get_public_key():
    return {"public_key": VAPID_PUBLIC_KEY}

@app.post("/api/push/subscribe")
def subscribe(subscription: SubscriptionModel):
    # Overwrite if endpoint already registered to keep clean tokens
    global subscribed_devices
    subscribed_devices = [d for d in subscribed_devices if d["endpoint"] != subscription.endpoint]
    subscribed_devices.append(subscription.dict())
    return {"status": "success", "message": "Subscription aligned successfully."}

@app.post("/api/emergency-alerts/simulate")
def simulate_alerts(data: dict):
    push_sent = 0
    push_failed = 0
    last_error = None

    message_payload = f"[{data.get('severity', 'HIGH').upper()}] {data.get('area')}: {data.get('message')}"

    for device in subscribed_devices:
        try:
            webpush(
                subscription_info={
                    "endpoint": device["endpoint"],
                    "keys": device["keys"]
                },
                data=message_payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS
            )
            push_sent += 1
        except WebPushException as ex:
            push_failed += 1
            # Extract underlying HTTP status codes
            if ex.response is not None:
                last_error = f"HTTP {ex.response.status_code}: {ex.response.text}"
            else:
                last_error = str(ex)

    return {
        "delivery_mode": "bcc" if push_failed == 0 else "fallback",
        "channels": ["Push", "SMS Fallback"] if push_failed > 0 else ["Push Notification"],
        "estimated_reached_devices": push_sent,
        "estimated_unreachable_devices": push_failed,
        "explanation": "Modeled over regional communication infrastructure.",
        "push_sent": push_sent,
        "push_failed": push_failed,
        "push_error": last_error,
        "sms_attempted": 0,
        "sms_sent": 0,
        "sms_failed": 0
    }