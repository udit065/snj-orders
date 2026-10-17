"""Staff logins.

    python manage.py add-user ramesh "Ramesh Kumar"    # asks for a password
    python manage.py disable-user ramesh
    python manage.py list-users
"""

import getpass
import sys

import db


def main(argv):
    db.init()
    if len(argv) >= 2 and argv[0] == "add-user":
        name = argv[2] if len(argv) > 2 else argv[1]
        pw = getpass.getpass(f"Password for {argv[1]}: ")
        if len(pw) < 8:
            sys.exit("Use at least 8 characters.")
        db.set_user(argv[1], name, pw)
        print(f"Saved login for {argv[1]}.")
    elif len(argv) == 2 and argv[0] == "disable-user":
        with db.connect() as c:
            c.execute("UPDATE users SET active=0 WHERE username=?", (argv[1].lower(),))
        print(f"Disabled {argv[1]}.")
    elif argv[:1] == ["list-users"]:
        with db.connect() as c:
            for u in c.execute("SELECT username, name, active FROM users ORDER BY username"):
                print(f'{u["username"]:20} {u["name"]:30} {"active" if u["active"] else "disabled"}')
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
