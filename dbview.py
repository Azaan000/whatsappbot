import sqlite3

conn = sqlite3.connect("database.db")
cursor = conn.cursor()

def view_users():
    cursor.execute("SELECT * FROM users")
    rows = cursor.fetchall()

    print("\n--- USERS ---")
    for row in rows:
        print(row)


def view_messages():
    cursor.execute("SELECT * FROM messages")
    rows = cursor.fetchall()

    print("\n--- ALL MESSAGES ---")
    for row in rows:
        print(row)


def view_user_messages(phone):
    cursor.execute("SELECT * FROM messages WHERE phone = ?", (phone,))
    rows = cursor.fetchall()

    print(f"\n--- MESSAGES FOR {phone} ---")
    for row in rows:
        print(row)


# RUN FUNCTIONS
if __name__ == "__main__":
    view_users()
    view_messages()

    # optional:
    # view_user_messages("923xxxxxxxxx")