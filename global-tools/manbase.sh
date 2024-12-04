#!/bin/bash
if ! command -v dialog &> /dev/null; then
    echo "Dialog is not installed. Installing..."
    sudo apt-get update && sudo apt-get install -y dialog
fi
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'
check_status() {
    local service=$1
    if systemctl is-active --quiet $service; then
        echo -e "${GREEN}Running${NC}"
    else
        echo -e "${RED}Stopped${NC}"
    fi
}
manage_xampp() {
    while true; do
        XAMPP_ACTION=$(dialog --clear --title "XAMPP Management" \
            --menu "Select Action:" 15 50 4 \
            1 "Start XAMPP" \
            2 "Stop XAMPP" \
            3 "Check Status" \
            4 "Back to Main Menu" \
            2>&1 >/dev/tty)

        clear
        case $XAMPP_ACTION in
            1)
                sudo /opt/lampp/lampp start
                sleep 2
                ;;
            2)
                sudo /opt/lampp/lampp stop
                sleep 2
                ;;
            3)
                sudo /opt/lampp/lampp status
                read -p "Press Enter to continue..."
                ;;
            4)
                break
                ;;
        esac
    done
}
manage_mysql() {
    while true; do
        MYSQL_ACTION=$(dialog --clear --title "MySQL Management" \
            --menu "Select Action:" 15 50 4 \
            1 "Start MySQL" \
            2 "Stop MySQL" \
            3 "Check Status" \
            4 "Back to Main Menu" \
            2>&1 >/dev/tty)

        clear
        case $MYSQL_ACTION in
            1)
                sudo systemctl start mysql
                echo "MySQL starting..."
                sleep 2
                ;;
            2)
                sudo systemctl stop mysql
                echo "MySQL stopping..."
                sleep 2
                ;;
            3)
                echo -n "MySQL Status: "
                check_status mysql
                read -p "Press Enter to continue..."
                ;;
            4)
                break
                ;;
        esac
    done
}
manage_postgresql() {
    while true; do
        PGSQL_ACTION=$(dialog --clear --title "PostgreSQL Management" \
            --menu "Select Action:" 15 50 4 \
            1 "Start PostgreSQL" \
            2 "Stop PostgreSQL" \
            3 "Check Status" \
            4 "Back to Main Menu" \
            2>&1 >/dev/tty)

        clear
        case $PGSQL_ACTION in
            1)
                sudo systemctl start postgresql
                echo "PostgreSQL starting..."
                sleep 2
                ;;
            2)
                sudo systemctl stop postgresql
                echo "PostgreSQL stopping..."
                sleep 2
                ;;
            3)
                echo -n "PostgreSQL Status: "
                check_status postgresql
                read -p "Press Enter to continue..."
                ;;
            4)
                break
                ;;
        esac
    done
}
manage_redis() {
    while true; do
        REDIS_ACTION=$(dialog --clear --title "Redis Management" \
            --menu "Select Action:" 15 50 4 \
            1 "Start Redis" \
            2 "Stop Redis" \
            3 "Check Status" \
            4 "Back to Main Menu" \
            2>&1 >/dev/tty)

        clear
        case $REDIS_ACTION in
            1)
                sudo systemctl start redis-server
                echo "Redis starting..."
                sleep 2
                ;;
            2)
                sudo systemctl stop redis-server
                echo "Redis stopping..."
                sleep 2
                ;;
            3)
                echo -n "Redis Status: "
                check_status redis-server
                read -p "Press Enter to continue..."
                ;;
            4)
                break
                ;;
        esac
    done
}
manage_denis() {
    while true; do
        DENIS_ACTION=$(dialog --clear --title "Denis Management" \
            --menu "Select Action:" 15 50 4 \
            1 "Start Denis" \
            2 "Stop Denis" \
            3 "Check Status" \
            4 "Back to Main Menu" \
            2>&1 >/dev/tty)

        clear
        case $DENIS_ACTION in
            1)
                sudo systemctl start denis.service
                echo "Denis starting..."
                sleep 2
                ;;
            2)
                sudo systemctl stop denis.service
                echo "Denis stopping..."
                sleep 2
                ;;
            3)
                echo -n "Denis Status: "
                check_status denis.service
                read -p "Press Enter to continue..."
                ;;
            4)
                break
                ;;
        esac
    done
}

# Main menu loop
while true; do
    CHOICE=$(dialog --clear --title "Database Management System" \
        --menu "Select Service to Manage:" 15 50 5 \
        1 "XAMPP" \
        2 "MySQL" \
        3 "PostgreSQL" \
        4 "Redis" \
        5 "Denis" \
        6 "Exit" \
        2>&1 >/dev/tty)

    clear
    case $CHOICE in
        1)
            manage_xampp
            ;;
        2)
            manage_mysql
            ;;
        3)
            manage_postgresql
            ;;
        4)
            manage_redis
            ;;
        5)
            manage_denis
            ;;
        6)
            echo "Exiting..."
            exit 0
            ;;
    esac
done
