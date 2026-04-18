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

def count_messages():
        cursor.execute("SELECT COUNT(*) FROM messages")
        count = cursor.fetchone()[0]
        print(f"\n--- TOTAL MESSAGES: {count} ---")

def timestamp():
        cursor.execute("SELECT timestamp FROM messages LIMIT 5")
        timestamps = cursor.fetchall()
        print("\n--- TIMESTAMPS ---")
        for ts in timestamps:
            print(ts[0])  # Assuming `ts` is a tuple and the timestamp is the first element

def update_timestamps():
    cursor.execute("UPDATE messages SET timestamp = REPLACE(timestamp, 'T', ' ');")
    conn.commit()  # Save changes to the database
    print("Timestamps updated successfully.")
# RUN FUNCTIONS
if __name__ == "__main__":
    view_users()
    view_messages()
    count_messages()
    timestamp()
    update_timestamps()

    # optional:
    # view_user_messages("923xxxxxxxxx")