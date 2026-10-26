N8N Housekeeper เพิ่ม Phone input เซฟลง DB

Add Login for each role
- ทำ หน้า login ของ Dashboard และทำ Permission ให้เห็นเฉพาะ Page ตาม Role นั้นๆ
    CEO = เห็น Overview
    Receptionist = เห็น Reservation
    IT Support = เห็น Support (ตอนนี้ยังไม่มี)
    Owner = เห็นทุกอย่าง อนุมัติทุก Permission

- ทำ IT Support Role | หน้าเฉพาะของ dashboard ชื่อ Support Section ทำฟอร์ม input สำหรับทำ CRUD ของ user ขึ้นมา | default เป็น เบอร์โทรไปแก้เองใน profile หลัง login
- เพิ่มปุ่ม Viewprofile ของแต่ละ หน้าของ Page Overview / Reservation / Support ไว้เข้าไปดู profile ของตนเองหลัง login | แสดง worker_name , role , phone , password(editable)



Add Role

1.Customer
- Login
- Check room
- Booking
- Claming form (ยัง)

2.Housekeeper
- Register
- Change room status Maintenance > Available

3.CEO
- Edit profile
- Seeing Analytics number

4.Receptionist
- Edit profile
- Check/Approve Slips
- Checkin/Checkout user
- Approve Claiming form ("Approve" return 70% for fully_dep in 3 day before checkin , after midnight of checkin take "Decline") (ยัง)

5 IT Support
- CRUD Internal user (ยัง)



Fix bug
- if user not using line?
- check 2 user booking same date
- use redirect link in rich menu (visit site) loey
- check if sent image what happen
- cancel after success the payment (customer | Receptionist)
- add housekeeper alert for maintenance room
- receptionist input data for Walk- in customer register
- check login consent not check all agreement