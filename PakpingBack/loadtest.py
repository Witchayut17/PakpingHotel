import random
import uuid
from datetime import date, timedelta
from locust import HttpUser, task, between

ROOMS = [f"{block}{n}" for block in "AB" for n in range(1, 6)]
MAX_DAYS_AHEAD = 365
MAX_STAY = 3

booked = {room: [] for room in ROOMS}

def random_phone():
    return "".join(random.choices("0123456789", k=10))

def is_free(room, check_in, check_out):
    for b_in, b_out in booked[room]:
        if check_in < b_out and check_out > b_in:
            return False
    return True

def reserve_slot(tries=50):
    for _ in range(tries):
        room = random.choice(ROOMS)
        check_in = date.today() + timedelta(days=random.randint(1, MAX_DAYS_AHEAD))
        check_out = check_in + timedelta(days=random.randint(1, MAX_STAY))
        if is_free(room, check_in, check_out):
            booked[room].append((check_in, check_out))
            return room, check_in, check_out
    return None

class Booking(HttpUser):
    wait_time = between(1, 2)

    @task
    def post_booking(self):
        slot = reserve_slot()
        if slot is None:
            return
        room, check_in, check_out = slot
        payload = {
            "user_name": f"loadtest_{random.randint(1, 10000)}",
            "user_phone": random_phone(),
            "user_id": str(uuid.uuid4()),
            "room_number": room,
            "check_in": check_in.isoformat(),
            "check_out": check_out.isoformat(),
            "action": "full_payment",
        }
        with self.client.post(
            "/post_booking",
            json=payload,
            name="/post_booking",
            catch_response=True,
        ) as resp:
            if resp.status_code not in (200, 201):
                booked[room].remove((check_in, check_out))
                resp.failure(f"Status {resp.status_code}: {resp.text[:200]}")
            else:
                resp.success()

    # @task
    # def list_room(self):
    #     self.client.get(url="/list_room")

    # @task
    # def list_user_payment(self):
    #     params = {"userId": "U2e4d0488b13bf29ed294f3736bf2a1b8"}
    #     with self.client.get(
    #         "/list_user_payments",
    #         params=params,
    #         name="/list_user_payments",
    #         catch_response=True,
    #     ) as resp:
    #         if resp.status_code != 200:
    #             resp.failure(f"Status {resp.status_code}: {resp.text[:200]}")
    #             return
    #         try:
    #             data = resp.json()
    #         except ValueError:
    #             resp.failure("Response is not valid JSON")
    #             return
    #         if "payments" not in data:
    #             resp.failure("Missing 'payments' key in response")
    #         else:
    #             resp.success()
