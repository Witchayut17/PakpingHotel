N8N Housekeeper เพิ่ม Phone input เซฟลง DB (เสร็จ)

Add Login for each role
- ทำหน้า register ของ Dashboard ใส่ input 3 field คือ name , password , role dropdown ให้เลือก 3 อันคือ IT Support , CEO , Redceptionist , Owner , แล้ว save data ลง table Worker (ตัว password ให้ hash ก่อนเซฟ) (เสร็จ)

- ทำ หน้า login ของ Dashboard และทำ Permission ให้เห็นเฉพาะ Page ตาม Role นั้นๆ (โดยใช้ 2 field ID - Password โดยเอาข้อมูลจากตาราง Worker มา) โดยแต่ละ role ทำได้ดังนี้
    CEO = เห็น Overview
    Receptionist = เห็น Reservation
    IT Support = เห็น Support (ตอนนี้ยังไม่มี)
    Owner = เห็นทุกอย่าง อนุมัติทุก Permission (เสร็จ)

- ทำ IT Support Role | หน้าเฉพาะของ dashboard ชื่อ Support Section ทำฟอร์ม input สำหรับทำ CRUD ของ user ขึ้นมา | default เป็น เบอร์โทรไปแก้เองใน profile หลัง login (เสร็จ)

- เพิ่มปุ่ม Viewprofile ของแต่ละ หน้าของ Page Overview / Reservation / Support ไว้เข้าไปดู profile ของตนเองหลัง login | แสดง worker_name , role , phone , password(editable) (เสร็จ)

Add Role

1.Customer
- Login (เสร็จ)
- Check room (เสร็จ)
- Booking (เสร็จ)
- Claming form (เสร็จ)

2.Housekeeper
- Register (เสร็จ)
- Change room status Maintenance > Available (เสร็จ)

3.CEO
- Edit profile (เสร็จ)
- Seeing Analytics number (เสร็จ)

4.Receptionist
- Edit profile (เสร็จ)
- Check/Approve Slips (เสร็จ)
- Checkin/Checkout user (เสร็จ)
- Approve Claiming form ("Approve" return 70% for fully_dep in 3 day before checkin , after midnight of checkin take "Decline") (เสร็จ)

5 IT Support
- CRUD Internal user (เสร็จ)



Fix bug
- if user not using line?
- check 2 user booking same date ผ่าน
- use redirect link in rich menu (visit site) loey ผ่าน
- check if sent image what happen ผ่าน
- cancel after success the payment (customer | Receptionist) ผ่าน
- add housekeeper alert for maintenance room ผ่าน
- receptionist input data for Walk- in customer register เสร็จ
- check login consent not check all agreement เสร็จ